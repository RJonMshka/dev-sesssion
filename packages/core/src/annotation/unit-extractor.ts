/**
 * Code-unit extraction — splits a parsed source file into addressable units
 * (LLD-code-units.md, REQ-UNIT-1..4).
 *
 * A unit is a top-level declaration, exported or not, or a method of a
 * top-level class or object literal. Each carries a line range, a token cost,
 * and a content hash, which is what lets a prompt load one function instead of
 * its whole file and lets a later session check that reference still holds.
 *
 * Pure functions over the AST that {@link AutoExtractor} has already parsed —
 * there is no second parse.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { TokenCounter } from "../counters/token-counter.js";
import type { ParsedUnit, UnitKind } from "./types.js";

/** Hex characters kept from a SHA-256 digest. Part of the PROTOCOL.md contract. */
const HASH_HEX_CHARS = 16;

/** One identifier: ECMAScript `ID_Start` / `ID_Continue`, plus `$` and `_`. */
const IDENTIFIER_SRC = "[\\p{ID_Start}$_][\\p{ID_Continue}$\\u200C\\u200D]*";

/**
 * A member name: identifier characters plus `-`, so a kebab-case key such as
 * `"dry-run"` stays addressable. No spaces, dots or other punctuation, so it
 * reads as a reference, the way a file path does.
 */
const MEMBER_NAME_SRC = "[\\p{ID_Continue}$\\u200C\\u200D-]+";

/** A whole string that is a usable member name. */
const MEMBER_NAME_RE = new RegExp(`^${MEMBER_NAME_SRC}$`, "u");

/**
 * Shape of every unit id: a declared name, optionally `.member` or
 * `.#member`, then an optional `~n` repeat suffix. Single source of truth for
 * the extractor and the index reader (REQ-PROV-9, -10).
 */
export const UNIT_ID_RE = new RegExp(
	`^${IDENTIFIER_SRC}(?:\\.#?${MEMBER_NAME_SRC})?(?:~\\d+)?$`,
	"u",
);

/**
 * Whether a string is a well-formed unit id — a reference, never free text.
 *
 * @param id - A candidate id.
 * @returns `true` when it matches {@link UNIT_ID_RE}.
 */
export function isUnitId(id: string): boolean {
	return UNIT_ID_RE.test(id);
}

/**
 * Hashes text per the PROTOCOL.md contract: SHA-256, first 16 hex characters.
 *
 * @param text - The text to hash.
 * @returns The truncated hex digest.
 */
export function contentHash(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex").slice(0, HASH_HEX_CHARS);
}

/**
 * Returns lines `start..end` (1-based, inclusive) joined with `\n`.
 *
 * This is exactly the text a unit's hash and token cost are computed over.
 *
 * @param lines - The file split on `\n`.
 * @param start - First line, 1-based.
 * @param end - Last line, 1-based, inclusive.
 * @returns The joined slice.
 */
export function sliceLines(lines: readonly string[], start: number, end: number): string {
	return lines.slice(start - 1, end).join("\n");
}

/**
 * Finds the `/** … *\/` comment immediately preceding a node.
 *
 * "Immediately" means only whitespace lies between the comment's end and the
 * node's start; a nearer non-JSDoc comment or any code breaks the attachment.
 *
 * @param ast - The program, which carries every comment.
 * @param node - The node to look above.
 * @param source - Raw source text, for the whitespace-gap check.
 * @returns The attached comment, or `null`.
 */
export function findLeadingJsdocComment(
	ast: TSESTree.Program,
	node: TSESTree.Node,
	source: string,
): TSESTree.Comment | null {
	const comments = ast.comments ?? [];
	const nodeStart = node.range[0];

	for (let i = comments.length - 1; i >= 0; i--) {
		const comment = comments[i];
		if (!comment || comment.type !== "Block") continue;
		if (!comment.value.startsWith("*")) continue;
		const commentEnd = comment.range[1];
		if (commentEnd > nodeStart) continue;
		return /^\s*$/.test(source.slice(commentEnd, nodeStart)) ? comment : null;
	}
	return null;
}

/** A unit before its id is made unique and its text is measured. */
interface RawUnit {
	readonly baseId: string;
	readonly kind: UnitKind;
	readonly start: number;
	readonly end: number;
	readonly exported: boolean;
}

/** Shared state for one file's extraction. */
interface ExtractCtx {
	readonly ast: TSESTree.Program;
	readonly source: string;
	readonly out: RawUnit[];
}

/**
 * Extracts every code unit from a parsed program.
 *
 * @param ast - The program, parsed with `range`, `loc` and `comment` enabled.
 * @param source - The raw source the program was parsed from.
 * @returns Units in source order, with ids unique within the file.
 */
export function extractUnits(ast: TSESTree.Program, source: string): ParsedUnit[] {
	const ctx: ExtractCtx = { ast, source, out: [] };
	for (const statement of ast.body) {
		collectStatement(ctx, statement);
	}
	return finalize(ctx.out, source.split("\n"));
}

/**
 * Assigns unique ids and measures each unit's text.
 *
 * @param raw - Units in source order.
 * @param lines - The file split on `\n`.
 * @returns The finished units.
 */
function finalize(raw: readonly RawUnit[], lines: readonly string[]): ParsedUnit[] {
	const seen = new Map<string, number>();
	return raw.map((u) => {
		const n = (seen.get(u.baseId) ?? 0) + 1;
		seen.set(u.baseId, n);
		const text = sliceLines(lines, u.start, u.end);
		return {
			id: n === 1 ? u.baseId : `${u.baseId}~${String(n)}`,
			kind: u.kind,
			start: u.start,
			end: u.end,
			tokens: TokenCounter.heuristicCount(text),
			hash: contentHash(text),
			exported: u.exported,
			// Filled in by the usage pass (usage-extractor.ts).
			refs: 0,
		};
	});
}

/**
 * Returns the first line of a statement, extended up to its attached JSDoc.
 *
 * @param ctx - Extraction state.
 * @param node - The outermost node of the statement (the `export` when present).
 * @returns 1-based start line.
 */
function startLine(ctx: ExtractCtx, node: TSESTree.Node): number {
	const doc = findLeadingJsdocComment(ctx.ast, node, ctx.source);
	return doc ? doc.loc.start.line : node.loc.start.line;
}

/**
 * Collects units from one top-level statement.
 *
 * @param ctx - Extraction state.
 * @param statement - A member of `program.body`.
 */
function collectStatement(ctx: ExtractCtx, statement: TSESTree.ProgramStatement): void {
	if (statement.type === "ExportNamedDeclaration") {
		// `export { a, b }` re-exports a declaration that already produced a unit.
		if (statement.declaration) collectDeclaration(ctx, statement.declaration, statement, true);
		return;
	}
	if (statement.type === "ExportDefaultDeclaration") {
		const decl = statement.declaration;
		if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
			collectDeclaration(ctx, decl, statement, true);
		}
		return;
	}
	collectDeclaration(ctx, statement, statement, false);
}

/** Declaration node types that map one-to-one onto a unit kind. */
const SIMPLE_KINDS: Readonly<Record<string, UnitKind>> = {
	FunctionDeclaration: "function",
	TSDeclareFunction: "function",
	TSTypeAliasDeclaration: "type",
	TSInterfaceDeclaration: "interface",
	TSEnumDeclaration: "enum",
};

/**
 * Collects units from a declaration, using `outer` for the range start.
 *
 * @param ctx - Extraction state.
 * @param decl - The declaration itself.
 * @param outer - The node whose start (and JSDoc) begins the range.
 * @param exported - Whether the declaration is exported.
 */
function collectDeclaration(
	ctx: ExtractCtx,
	decl: TSESTree.Node,
	outer: TSESTree.Node,
	exported: boolean,
): void {
	if (decl.type === "VariableDeclaration") {
		collectVariables(ctx, decl, outer, exported);
		return;
	}
	if (decl.type === "ClassDeclaration") {
		const id = decl.id?.name ?? "default";
		push(ctx, id, "class", startLine(ctx, outer), outer.loc.end.line, exported);
		collectClassMembers(ctx, id, decl.body, exported);
		return;
	}
	const kind = SIMPLE_KINDS[decl.type];
	if (kind === undefined) return;
	const name = declaredName(decl);
	push(ctx, name ?? "default", kind, startLine(ctx, outer), outer.loc.end.line, exported);
}

/**
 * Returns the identifier a simple declaration introduces.
 *
 * @param decl - A function, type alias, interface or enum declaration.
 * @returns The name, or `undefined` for an anonymous declaration.
 */
function declaredName(decl: TSESTree.Node): string | undefined {
	if (
		decl.type === "FunctionDeclaration" ||
		decl.type === "TSDeclareFunction" ||
		decl.type === "TSTypeAliasDeclaration" ||
		decl.type === "TSInterfaceDeclaration" ||
		decl.type === "TSEnumDeclaration"
	) {
		return decl.id?.name;
	}
	return undefined;
}

/**
 * Collects one unit per named declarator, plus the members of an object literal.
 *
 * A single-declarator statement — the common case — spans the whole statement.
 * With several declarators the first extends back to the statement start and
 * the last forward to its end, so the ranges tile without overlapping.
 *
 * @param ctx - Extraction state.
 * @param decl - The variable declaration.
 * @param outer - The node whose start begins the first range.
 * @param exported - Whether the declaration is exported.
 */
function collectVariables(
	ctx: ExtractCtx,
	decl: TSESTree.VariableDeclaration,
	outer: TSESTree.Node,
	exported: boolean,
): void {
	const last = decl.declarations.length - 1;
	decl.declarations.forEach((d, i) => {
		if (d.id.type !== "Identifier") return;
		const init = unwrap(d.init);
		const start = i === 0 ? startLine(ctx, outer) : d.loc.start.line;
		const end = i === last ? outer.loc.end.line : d.loc.end.line;
		push(ctx, d.id.name, isFunctionNode(init) ? "function" : "variable", start, end, exported);
		if (init?.type === "ObjectExpression") {
			collectObjectMembers(ctx, d.id.name, init, exported);
		}
	});
}

/**
 * Strips `as` / `satisfies` / non-null wrappers from an expression.
 *
 * Shared with the usage pass, so both agree on what an object-literal API is.
 *
 * @param node - The expression, possibly wrapped.
 * @returns The innermost expression, or `null`.
 */
export function unwrap(node: TSESTree.Expression | null): TSESTree.Expression | null {
	let current = node;
	while (
		current &&
		(current.type === "TSAsExpression" ||
			current.type === "TSSatisfiesExpression" ||
			current.type === "TSNonNullExpression")
	) {
		current = current.expression;
	}
	return current;
}

/**
 * Whether a node is a function or arrow-function expression.
 *
 * @param node - Any node, or `null`.
 * @returns `true` for a function-valued expression.
 */
function isFunctionNode(node: TSESTree.Node | null | undefined): boolean {
	return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

/**
 * Returns a member's name when it has a static, name-shaped one.
 *
 * @param key - The member's key node.
 * @param computed - Whether the key is computed (`[expr]`).
 * @returns The name, or `undefined` for a computed key or a string key that
 *   is not name-shaped (`"a b"`, `"a.b"`, `""`).
 */
function memberName(key: TSESTree.Node, computed: boolean): string | undefined {
	if (computed) return undefined;
	if (key.type === "Identifier") return key.name;
	if (key.type === "PrivateIdentifier") return `#${key.name}`;
	// A string key becomes part of an id, and ids are printed on the prompt's
	// Focus line. Only a name-shaped key keeps that a reference rather than
	// text from the file (REQ-PROV-9).
	if (key.type === "Literal" && typeof key.value === "string" && MEMBER_NAME_RE.test(key.value)) {
		return key.value;
	}
	return undefined;
}

/**
 * Collects the methods of a class, including function-valued fields.
 *
 * @param ctx - Extraction state.
 * @param parent - The class's unit id.
 * @param body - The class body.
 * @param exported - Whether the class is exported.
 */
function collectClassMembers(
	ctx: ExtractCtx,
	parent: string,
	body: TSESTree.ClassBody,
	exported: boolean,
): void {
	for (const m of body.body) {
		const isMethod = m.type === "MethodDefinition" || m.type === "TSAbstractMethodDefinition";
		const isFnField = m.type === "PropertyDefinition" && isFunctionNode(m.value);
		if (!isMethod && !isFnField) continue;
		const name = memberName(m.key, m.computed);
		if (name === undefined) continue;
		push(ctx, `${parent}.${name}`, "method", startLine(ctx, m), m.loc.end.line, exported);
	}
}

/**
 * Collects the function-valued properties of an object literal.
 *
 * @param ctx - Extraction state.
 * @param parent - The variable's unit id.
 * @param obj - The object literal.
 * @param exported - Whether the variable is exported.
 */
function collectObjectMembers(
	ctx: ExtractCtx,
	parent: string,
	obj: TSESTree.ObjectExpression,
	exported: boolean,
): void {
	for (const p of obj.properties) {
		if (p.type !== "Property" || !isFunctionNode(p.value)) continue;
		const name = memberName(p.key, p.computed);
		if (name === undefined) continue;
		push(ctx, `${parent}.${name}`, "method", startLine(ctx, p), p.loc.end.line, exported);
	}
}

/**
 * Appends a raw unit.
 *
 * @param ctx - Extraction state.
 * @param baseId - Id before de-duplication.
 * @param kind - Declaration kind.
 * @param start - First line.
 * @param end - Last line.
 * @param exported - Whether exported.
 */
function push(
	ctx: ExtractCtx,
	baseId: string,
	kind: UnitKind,
	start: number,
	end: number,
	exported: boolean,
): void {
	ctx.out.push({ baseId, kind, start, end, exported });
}
