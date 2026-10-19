/**
 * Usage facts — what a file imports, and which of its own declarations it
 * certainly references (LLD-code-units.md, REQ-UNIT-31, REQ-UNIT-34).
 *
 * These are the evidence the unit focus resolver weighs when a task names
 * something declared in several places. Every fact errs toward *absent*: a
 * reference that an inner binding of the same name could capture is not
 * counted, and an import whose specifier cannot be resolved to a file on disk
 * is not recorded. Missing evidence makes the resolver refuse; wrong evidence
 * would make it point at the wrong code.
 *
 * One pass over the AST, no type checker, no new dependency.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import type { ParsedImport } from "./types.js";
import { unwrap } from "./unit-extractor.js";

/** Facts about one file. */
export interface UsageFacts {
	/** Relative imports and re-exports resolved to an existing file. */
	readonly imports: readonly ParsedImport[];
	/** `local.prop` accesses whose object is an imported binding, sorted, unique. */
	readonly memberRefs: readonly string[];
	/** Names the file exports through a local `export { name }` or `export default name`. */
	readonly localExports: ReadonlySet<string>;
	/**
	 * Certain in-file references to a unit, by id (`name` or `Parent.member`,
	 * without a `~n` suffix), excluding those inside the unit's own lines.
	 */
	refsFor(id: string, start: number, end: number): number;
}

/** Counters filled during the walk. */
interface Counts {
	/** Every binding of a name, in any scope. */
	readonly bindings: Map<string, number>;
	/** Bindings at module scope (top-level declarations and import locals). */
	readonly moduleBindings: Map<string, number>;
	/** Identifier references: the line of each. */
	readonly refs: Map<string, number[]>;
	/** `Obj.prop` accesses, keyed `Obj.prop`: the line of each. */
	readonly members: Map<string, number[]>;
	/** `this.prop` inside a top-level class or object's own methods, keyed `Owner.prop`. */
	readonly thisMembers: Map<string, number[]>;
}

/** Walk state passed down the tree. */
interface Ctx {
	/** Identifiers here declare bindings (inside a parameter or declarator pattern). */
	readonly pattern: boolean;
	/** The top-level class or object `this` refers to, if certain. */
	readonly owner: string | null;
	/** Owner to adopt on entering the next non-arrow function (a member's own body). */
	readonly methodOwner: string | null;
}

/** Keys that never lead to code. */
const SKIP_KEYS = new Set(["parent", "loc", "range", "type", "tokens", "comments"]);

/**
 * Increments a counter.
 *
 * @param map - The counter.
 * @param key - The key.
 */
function bump(map: Map<string, number>, key: string): void {
	map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Records the line of an occurrence.
 *
 * @param map - Occurrences by key.
 * @param key - The key.
 * @param line - 1-based line.
 */
function note(map: Map<string, number[]>, key: string, line: number): void {
	const lines = map.get(key);
	if (lines) lines.push(line);
	else map.set(key, [line]);
}

/**
 * Counts occurrences outside a line range — a declaration referring to
 * itself (recursion) is not evidence that anything uses it.
 *
 * @param lines - Lines of each occurrence.
 * @param start - First line to exclude.
 * @param end - Last line to exclude.
 * @returns Occurrences outside the range.
 */
function outside(lines: readonly number[] | undefined, start: number, end: number): number {
	return (lines ?? []).filter((l) => l < start || l > end).length;
}

/**
 * Whether a value is an AST node.
 *
 * @param v - Anything.
 * @returns True for objects carrying a string `type`.
 */
function isNode(v: unknown): v is TSESTree.Node {
	return typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
}

/** Parent types whose `key` child is a name, not a reference, unless computed. */
const KEYED = new Set([
	"Property",
	"MethodDefinition",
	"PropertyDefinition",
	"TSAbstractMethodDefinition",
	"TSAbstractPropertyDefinition",
	"AccessorProperty",
	"TSPropertySignature",
	"TSMethodSignature",
]);

/** Parent types whose `id` child declares a binding. */
const DECLARES_ID = new Set([
	"FunctionDeclaration",
	"FunctionExpression",
	"ClassDeclaration",
	"ClassExpression",
	"TSDeclareFunction",
	"TSInterfaceDeclaration",
	"TSTypeAliasDeclaration",
	"TSEnumDeclaration",
	"TSModuleDeclaration",
]);

/**
 * Classifies an identifier by its position.
 *
 * @param parent - The parent node.
 * @param key - The parent's key holding the identifier.
 * @param ctx - Walk state.
 * @returns What the identifier is.
 */
function classify(parent: TSESTree.Node | null, key: string, ctx: Ctx): "binding" | "ref" | "name" {
	if (parent === null) return "ref";
	const p = parent as unknown as { type: string; computed?: boolean };
	if (KEYED.has(p.type) && key === "key" && p.computed !== true) return "name";
	if (p.type === "MemberExpression" && key === "property" && p.computed !== true) return "name";
	if (p.type === "TSQualifiedName" && key === "right") return "name";
	if (p.type === "TSEnumMember" && key === "id") return "name";
	if (key === "label" || p.type === "MetaProperty") return "name";
	if (p.type === "ImportSpecifier" && key === "imported") return "name";
	// Exporting a name is not using it (REQ-UNIT-34 records it as exported instead).
	if (p.type === "ExportSpecifier") return "name";
	if (p.type === "ExportDefaultDeclaration" && key === "declaration") return "name";
	if (key === "local" && p.type.startsWith("Import")) return "binding";
	if (DECLARES_ID.has(p.type) && key === "id") return "binding";
	if (p.type === "TSTypeParameter" && key === "name") return "binding";
	return ctx.pattern ? "binding" : "ref";
}

/**
 * Returns the walk state for a child, by the child's role in its parent.
 *
 * @param node - The parent.
 * @param key - The key the child sits under.
 * @param ctx - The parent's state.
 * @returns The child's state.
 */
function childCtx(node: TSESTree.Node, key: string, ctx: Ctx): Ctx {
	const t = node.type;
	const enters =
		(t === "VariableDeclarator" && key === "id") ||
		key === "params" ||
		(t === "CatchClause" && key === "param") ||
		(t === "TSParameterProperty" && key === "parameter");
	if (enters) return { ...ctx, pattern: true };
	const leaves =
		key === "typeAnnotation" ||
		key === "init" ||
		key === "body" ||
		(t === "AssignmentPattern" && key === "right") ||
		((t === "Property" || t === "MemberExpression") && key === "key" && node.computed === true);
	return leaves ? { ...ctx, pattern: false } : ctx;
}

/**
 * Records a member access `obj.prop` or `this.prop`.
 *
 * @param node - The member expression.
 * @param ctx - Walk state.
 * @param counts - Counters.
 */
function recordMember(node: TSESTree.MemberExpression, ctx: Ctx, counts: Counts): void {
	if (node.computed) return;
	const prop =
		node.property.type === "Identifier"
			? node.property.name
			: node.property.type === "PrivateIdentifier"
				? `#${node.property.name}`
				: undefined;
	if (prop === undefined) return;
	const line = node.loc.start.line;
	if (node.object.type === "Identifier") note(counts.members, `${node.object.name}.${prop}`, line);
	else if (node.object.type === "ThisExpression" && ctx.owner !== null) {
		note(counts.thisMembers, `${ctx.owner}.${prop}`, line);
	}
}

/**
 * Walks a subtree, counting bindings, references and member accesses.
 *
 * @param node - The node.
 * @param parent - Its parent.
 * @param key - The parent's key holding it.
 * @param ctx - Walk state.
 * @param counts - Counters.
 * @param moduleIds - Identifier nodes that are module-scope bindings.
 */
function walk(
	node: TSESTree.Node,
	parent: TSESTree.Node | null,
	key: string,
	ctx: Ctx,
	counts: Counts,
	moduleIds: ReadonlySet<TSESTree.Node>,
): void {
	if (node.type === "Identifier") {
		const kind = classify(parent, key, ctx);
		if (kind === "binding") {
			bump(counts.bindings, node.name);
			if (moduleIds.has(node)) bump(counts.moduleBindings, node.name);
		} else if (kind === "ref") note(counts.refs, node.name, node.loc.start.line);
	}
	if (node.type === "MemberExpression") recordMember(node, ctx, counts);
	// A non-arrow function rebinds `this`: only a member's own body keeps its owner.
	let here = ctx;
	if (node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
		here = { ...ctx, owner: ctx.methodOwner, methodOwner: null };
	} else if (node.type === "ArrowFunctionExpression") {
		// Arrows keep `this`, but a function nested inside one is not the member's body.
		here = { ...ctx, methodOwner: null };
	}
	for (const [k, v] of Object.entries(node)) {
		if (SKIP_KEYS.has(k)) continue;
		const next = childCtx(node, k, here);
		if (Array.isArray(v)) {
			for (const item of v) if (isNode(item)) walk(item, node, k, next, counts, moduleIds);
		} else if (isNode(v)) walk(v, node, k, next, counts, moduleIds);
	}
}

/**
 * Unwraps a top-level statement to its declaration.
 *
 * @param s - A program statement.
 * @returns The declaration inside an `export`, or the statement itself.
 */
function declarationOf(s: TSESTree.ProgramStatement): TSESTree.Node | null {
	if (s.type === "ExportNamedDeclaration") return s.declaration ?? null;
	if (s.type === "ExportDefaultDeclaration") return s.declaration;
	return s;
}

/**
 * Collects the identifier nodes that bind names at module scope.
 *
 * @param ast - The program.
 * @returns The set of binding identifier nodes.
 */
function moduleBindingIds(ast: TSESTree.Program): Set<TSESTree.Node> {
	const ids = new Set<TSESTree.Node>();
	for (const s of ast.body) {
		if (s.type === "ImportDeclaration") {
			for (const spec of s.specifiers) ids.add(spec.local);
			continue;
		}
		const d = declarationOf(s);
		if (d === null) continue;
		if (d.type === "VariableDeclaration") {
			for (const v of d.declarations) if (v.id.type === "Identifier") ids.add(v.id);
		} else if ("id" in d && isNode(d.id) && d.id.type === "Identifier") {
			ids.add(d.id);
		}
	}
	return ids;
}

/**
 * Walks one top-level statement, giving class and object members their owner.
 *
 * @param s - The statement.
 * @param counts - Counters.
 * @param moduleIds - Module-scope binding nodes.
 */
function walkStatement(
	s: TSESTree.ProgramStatement,
	counts: Counts,
	moduleIds: ReadonlySet<TSESTree.Node>,
): void {
	const base: Ctx = { pattern: false, owner: null, methodOwner: null };
	// `export { a } from "./x"` and `export * from` bind nothing in this file.
	if (s.type === "ExportAllDeclaration") return;
	if (s.type === "ExportNamedDeclaration" && s.source !== null) return;
	const d = declarationOf(s);
	if (d?.type === "ClassDeclaration" && d.id) {
		walkClass(d, d.id.name, counts, moduleIds);
		return;
	}
	if (d?.type === "VariableDeclaration") {
		walkVariables(d, counts, moduleIds);
		return;
	}
	walk(s, null, "", base, counts, moduleIds);
}

/**
 * Walks a top-level class: everything but the body as usual, then each member
 * with `this` owned by the class.
 *
 * @param d - The class.
 * @param name - Its name.
 * @param counts - Counters.
 * @param moduleIds - Module-scope binding nodes.
 */
function walkClass(
	d: TSESTree.ClassDeclaration,
	name: string,
	counts: Counts,
	moduleIds: ReadonlySet<TSESTree.Node>,
): void {
	const base: Ctx = { pattern: false, owner: null, methodOwner: null };
	for (const [k, v] of Object.entries(d)) {
		if (SKIP_KEYS.has(k) || k === "body") continue;
		if (Array.isArray(v)) {
			for (const item of v) if (isNode(item)) walk(item, d, k, base, counts, moduleIds);
		} else if (isNode(v)) walk(v, d, k, base, counts, moduleIds);
	}
	for (const m of d.body.body) {
		const owned: Ctx = { ...base, owner: name, methodOwner: name };
		walk(m, d.body, "body", owned, counts, moduleIds);
	}
}

/**
 * Walks a top-level variable declaration; object-literal methods own `this`.
 *
 * @param d - The declaration.
 * @param counts - Counters.
 * @param moduleIds - Module-scope binding nodes.
 */
function walkVariables(
	d: TSESTree.VariableDeclaration,
	counts: Counts,
	moduleIds: ReadonlySet<TSESTree.Node>,
): void {
	const base: Ctx = { pattern: false, owner: null, methodOwner: null };
	for (const v of d.declarations) {
		walk(v.id, v, "id", { ...base, pattern: true }, counts, moduleIds);
		const init = unwrap(v.init);
		if (init?.type !== "ObjectExpression" || v.id.type !== "Identifier") {
			if (v.init) walk(v.init, v, "init", base, counts, moduleIds);
			continue;
		}
		if (init !== v.init && v.init) walkTypeWrappers(v.init, counts, moduleIds);
		for (const p of init.properties) {
			const owned: Ctx = { ...base, methodOwner: v.id.name };
			walk(p, init, "properties", owned, counts, moduleIds);
		}
	}
}

/**
 * Walks the type annotations of `as` / `satisfies` wrappers around an object
 * literal, without walking the literal twice.
 *
 * @param e - The wrapped expression.
 * @param counts - Counters.
 * @param moduleIds - Module-scope binding nodes.
 */
function walkTypeWrappers(
	e: TSESTree.Expression,
	counts: Counts,
	moduleIds: ReadonlySet<TSESTree.Node>,
): void {
	const base: Ctx = { pattern: false, owner: null, methodOwner: null };
	let cur: TSESTree.Expression = e;
	while (cur.type === "TSAsExpression" || cur.type === "TSSatisfiesExpression") {
		walk(cur.typeAnnotation, cur, "typeAnnotation", base, counts, moduleIds);
		cur = cur.expression;
	}
}

/** Extension rewrites tried first: source beside its compiled name. */
const EXT_MAP: Readonly<Record<string, string>> = {
	".js": ".ts",
	".jsx": ".tsx",
	".mjs": ".mts",
	".cjs": ".cts",
};

/** Suffixes tried when a specifier omits its extension. */
const SUFFIXES = [
	".ts",
	".tsx",
	".mts",
	".js",
	".jsx",
	".mjs",
	"/index.ts",
	"/index.tsx",
	"/index.js",
];

/**
 * Resolves a relative import specifier to an existing file.
 *
 * @param fromFile - Absolute path of the importing file.
 * @param spec - The specifier.
 * @returns The absolute path, or `null` for a package, alias, or missing file.
 */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
	if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
	const base = path.resolve(path.dirname(fromFile), spec);
	const ext = path.extname(base);
	const mapped = EXT_MAP[ext];
	const candidates = [
		...(mapped !== undefined ? [base.slice(0, -ext.length) + mapped] : []),
		base,
		...SUFFIXES.map((s) => base + s),
	];
	for (const c of candidates) {
		try {
			if (fs.statSync(c).isFile()) return c;
		} catch {
			// Not this candidate.
		}
	}
	return null;
}

/**
 * Reads the name an import or export specifier refers to on the source side.
 *
 * @param n - An Identifier or string Literal.
 * @returns The name.
 */
function specName(n: TSESTree.Identifier | TSESTree.StringLiteral): string {
	return n.type === "Identifier" ? n.name : n.value;
}

/**
 * Collects resolved imports and re-exports.
 *
 * @param ast - The program.
 * @param filePath - Absolute path of the file.
 * @returns Imports in source order.
 */
function collectImports(ast: TSESTree.Program, filePath: string): ParsedImport[] {
	const out: ParsedImport[] = [];
	for (const s of ast.body) {
		const isReexport = s.type === "ExportNamedDeclaration" && s.source !== null;
		if (s.type !== "ImportDeclaration" && !isReexport) continue;
		const from = resolveSpecifier(filePath, (s as { source: TSESTree.StringLiteral }).source.value);
		if (from === null) continue;
		if (s.type === "ImportDeclaration") {
			for (const spec of s.specifiers) {
				const name =
					spec.type === "ImportSpecifier"
						? specName(spec.imported)
						: spec.type === "ImportNamespaceSpecifier"
							? "*"
							: "default";
				out.push({ from, name, local: spec.local.name });
			}
		} else if (s.type === "ExportNamedDeclaration") {
			for (const spec of s.specifiers) {
				out.push({ from, name: specName(spec.local), local: specName(spec.exported) });
			}
		}
	}
	return out;
}

/**
 * Collects names exported by a local specifier or `export default name`.
 *
 * @param ast - The program.
 * @returns The exported local names.
 */
function collectLocalExports(ast: TSESTree.Program): Set<string> {
	const names = new Set<string>();
	for (const s of ast.body) {
		if (s.type === "ExportNamedDeclaration" && s.source === null) {
			for (const spec of s.specifiers) names.add(specName(spec.local));
		} else if (s.type === "ExportDefaultDeclaration" && s.declaration.type === "Identifier") {
			names.add(s.declaration.name);
		}
	}
	return names;
}

/**
 * Whether a name could be captured by a binding other than its module-level ones.
 *
 * @param counts - Counters.
 * @param name - The name.
 * @returns True when some inner scope also binds the name.
 */
function shadowed(counts: Counts, name: string): boolean {
	return (counts.bindings.get(name) ?? 0) > (counts.moduleBindings.get(name) ?? 0);
}

/**
 * Extracts the usage facts of one parsed file.
 *
 * @param ast - The program, parsed with `range` and `loc`.
 * @param filePath - Absolute path of the file, for resolving imports.
 * @returns The file's usage facts.
 */
export function extractUsage(ast: TSESTree.Program, filePath: string): UsageFacts {
	const counts: Counts = {
		bindings: new Map(),
		moduleBindings: new Map(),
		refs: new Map(),
		members: new Map(),
		thisMembers: new Map(),
	};
	const moduleIds = moduleBindingIds(ast);
	for (const s of ast.body) walkStatement(s, counts, moduleIds);

	const imports = collectImports(ast, filePath);
	const importLocals = new Set(
		ast.body.flatMap((s) =>
			s.type === "ImportDeclaration" ? s.specifiers.map((x) => x.local.name) : [],
		),
	);
	const memberRefs = [...counts.members.keys()]
		.filter((k) => {
			const obj = k.slice(0, k.indexOf("."));
			return importLocals.has(obj) && !shadowed(counts, obj);
		})
		.sort();

	return {
		imports,
		memberRefs,
		localExports: collectLocalExports(ast),
		refsFor(id: string, start: number, end: number): number {
			const dot = id.indexOf(".");
			if (dot === -1) return shadowed(counts, id) ? 0 : outside(counts.refs.get(id), start, end);
			const parent = id.slice(0, dot);
			const viaName = shadowed(counts, parent) ? 0 : outside(counts.members.get(id), start, end);
			return viaName + outside(counts.thisMembers.get(id), start, end);
		},
	};
}
