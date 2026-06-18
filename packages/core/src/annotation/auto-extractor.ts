/**
 * AutoExtractor — extracts exported symbols from TypeScript/JS source files
 * using AST-based analysis (zero annotations required).
 *
 * Uses `@typescript-eslint/typescript-estree` for parsing. No regex. Supports
 * `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`. Skips `.vue`, `.svelte`.
 *
 * Any existing `/** * /` JSDoc summary blocks are captured automatically.
 * Optional `@ai-*` override tags (Chunk 13) are parsed transparently via
 * {@link AnnotationParser} — see {@link resolveOverrides}.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { ParseError } from "@dev-session/security";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { parse } from "@typescript-eslint/typescript-estree";
import { TokenCounter } from "../counters/token-counter.js";
import { GitignoreAwareWalker } from "../walkers/gitignore-aware-walker.js";
import { AnnotationParser } from "./annotation-parser.js";
import type { ParsedFile, ParsedSymbol, SymbolSurface } from "./types.js";

/** Shared, stateless parser for the optional `@ai-*` override tags (Chunk 13). */
const annotationParser = new AnnotationParser();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extensions handled by the extractor. */
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);

/** Max chars to include in a signature (avoids huge generics). */
const MAX_SIGNATURE_CHARS = 200;

// ---------------------------------------------------------------------------
// Public class
// ---------------------------------------------------------------------------

/**
 * Extracts exported symbols and module metadata from TypeScript/JS files.
 *
 * @example
 * ```typescript
 * const extractor = new AutoExtractor();
 * const result = await extractor.extractFile(validatedPath);
 * console.log(result.exports.map(s => s.name));
 * ```
 */
export class AutoExtractor {
	/**
	 * Extract all exported symbols from a single TypeScript/JS file.
	 *
	 * On parse errors, logs a warning and returns an empty result rather than
	 * throwing — callers should not crash the index pipeline on bad files.
	 *
	 * @param filePath - Validated absolute path to the file.
	 * @returns Extraction result with symbols, summaries, and token costs.
	 */
	extractFile(filePath: ValidatedPath): ParsedFile {
		const ext = path.extname(filePath);
		let source: string;

		try {
			source = fs.readFileSync(filePath, "utf-8");
		} catch (cause: unknown) {
			throw new ParseError({
				message: "Cannot read file for extraction",
				file: path.basename(filePath),
				cause,
			});
		}

		if (!SUPPORTED_EXTENSIONS.has(ext)) {
			return emptyParsedFile(filePath, source);
		}

		try {
			const isJsx = ext === ".jsx" || ext === ".tsx";
			const ast = parse(source, {
				comment: true,
				range: true,
				loc: true,
				jsx: isJsx,
				// Suppress typescript-estree warnings about project configuration
				errorOnUnknownASTType: false,
			});

			const moduleSummary = extractModuleSummary(ast);
			const exports = extractExports(ast, source);
			const tokenCost = TokenCounter.heuristicCount(source);

			return {
				path: filePath,
				moduleSummary,
				exports,
				tokenCost,
				tokenCostAccurate: false,
			};
		} catch {
			// Parse error (e.g., syntax error in the file) — emit warning and continue
			console.warn(`[AutoExtractor] Parse error in ${path.basename(filePath)}, skipping`);
			return emptyParsedFile(filePath, source);
		}
	}

	/**
	 * Extract symbols from all TypeScript/JS files in a directory tree.
	 *
	 * Walks the directory using {@link GitignoreAwareWalker} (respects `.gitignore`).
	 * Files that fail to parse return an empty result rather than stopping the walk.
	 *
	 * @param root - Validated absolute path to the project root.
	 * @param options - Optional walk configuration.
	 * @returns Array of extraction results, one per matched file.
	 */
	async extractDirectory(
		root: ValidatedPath,
		options?: { maxFiles?: number },
	): Promise<ParsedFile[]> {
		const files = GitignoreAwareWalker.walk(root as string, {
			extensions: [...SUPPORTED_EXTENSIONS],
		});

		const limit = options?.maxFiles ?? Number.MAX_SAFE_INTEGER;
		const results: ParsedFile[] = [];

		for (const walkedFile of files.slice(0, limit)) {
			// Cast absolute path: walker resolved it from filesystem, so it's valid
			const absPath = walkedFile.absolutePath as ValidatedPath;
			results.push(this.extractFile(absPath));
		}

		return results;
	}
}

// ---------------------------------------------------------------------------
// Internal: module summary
// ---------------------------------------------------------------------------

/**
 * Extract the module-level summary from the `@packageDocumentation` JSDoc block.
 *
 * @param ast - The parsed program AST.
 * @returns The first descriptive sentence of the module JSDoc, or `""`.
 */
function extractModuleSummary(ast: TSESTree.Program): string {
	const comments = ast.comments ?? [];
	for (const comment of comments) {
		if (comment.type !== "Block") continue;
		if (!comment.value.startsWith("*")) continue; // must be /** ... */
		if (!comment.value.includes("@packageDocumentation")) continue;
		return extractFirstSentence(comment.value);
	}
	return "";
}

// ---------------------------------------------------------------------------
// Internal: export extraction
// ---------------------------------------------------------------------------

/**
 * Walk the top-level AST statements and collect exported symbol metadata.
 *
 * @param ast - The parsed program.
 * @param source - The raw source string (for signature extraction).
 * @returns Array of parsed symbols.
 */
function extractExports(ast: TSESTree.Program, source: string): ParsedSymbol[] {
	const symbols: ParsedSymbol[] = [];

	for (const node of ast.body) {
		if (node.type === "ExportNamedDeclaration") {
			symbols.push(...handleNamedExport(node, ast, source));
		} else if (node.type === "ExportDefaultDeclaration") {
			const sym = handleDefaultExport(node, ast, source);
			if (sym) symbols.push(sym);
		}
	}

	return symbols;
}

/**
 * Handle `export function/class/const/type/interface` declarations.
 *
 * @param node - The ExportNamedDeclaration node.
 * @param ast - The full program (for comment lookup).
 * @param source - Raw source text.
 * @returns Zero or more parsed symbols.
 */
function handleNamedExport(
	node: TSESTree.ExportNamedDeclaration,
	ast: TSESTree.Program,
	source: string,
): ParsedSymbol[] {
	const { declaration } = node;
	if (!declaration) {
		// `export { foo, bar }` — specifier-only, skip
		return [];
	}

	const jsdoc = findLeadingJsdoc(ast, node, source);
	const overrides = resolveOverrides(jsdoc);

	switch (declaration.type) {
		case "FunctionDeclaration":
			if (declaration.id) {
				return [
					makeSymbol(
						declaration.id.name,
						extractSignature(source, declaration.range?.[0] ?? 0, declaration.range?.[1] ?? 0),
						declaration.loc?.start.line ?? 0,
						overrides,
					),
				];
			}
			return [];

		case "ClassDeclaration":
			if (declaration.id) {
				return [
					makeSymbol(
						declaration.id.name,
						extractSignature(source, declaration.range?.[0] ?? 0, declaration.range?.[1] ?? 0),
						declaration.loc?.start.line ?? 0,
						overrides,
					),
				];
			}
			return [];

		case "VariableDeclaration": {
			const syms: ParsedSymbol[] = [];
			for (const declarator of declaration.declarations) {
				if (declarator.id.type === "Identifier") {
					syms.push(
						makeSymbol(
							declarator.id.name,
							extractSignature(source, declaration.range?.[0] ?? 0, declaration.range?.[1] ?? 0),
							declaration.loc?.start.line ?? 0,
							overrides,
						),
					);
				}
			}
			return syms;
		}

		case "TSTypeAliasDeclaration":
			return [
				makeSymbol(
					declaration.id.name,
					extractSignature(source, declaration.range?.[0] ?? 0, declaration.range?.[1] ?? 0),
					declaration.loc?.start.line ?? 0,
					overrides,
				),
			];

		case "TSInterfaceDeclaration":
			return [
				makeSymbol(
					declaration.id.name,
					extractSignature(source, declaration.range?.[0] ?? 0, declaration.range?.[1] ?? 0),
					declaration.loc?.start.line ?? 0,
					overrides,
				),
			];

		default:
			return [];
	}
}

/**
 * Handle `export default function/class`.
 *
 * @param node - The ExportDefaultDeclaration node.
 * @param ast - The full program.
 * @param source - Raw source text.
 * @returns A symbol named `"default"` or `null`.
 */
function handleDefaultExport(
	node: TSESTree.ExportDefaultDeclaration,
	ast: TSESTree.Program,
	source: string,
): ParsedSymbol | null {
	const { declaration } = node;
	const jsdoc = findLeadingJsdoc(ast, node, source);
	const overrides = resolveOverrides(jsdoc);

	if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
		const name = declaration.id?.name ?? "default";
		return makeSymbol(
			name,
			extractSignature(source, declaration.range?.[0] ?? 0, declaration.range?.[1] ?? 0),
			declaration.loc?.start.line ?? 0,
			overrides,
		);
	}

	return null;
}

// ---------------------------------------------------------------------------
// Internal: JSDoc helpers
// ---------------------------------------------------------------------------

/**
 * Find the `/** * /` JSDoc comment that immediately precedes a node.
 *
 * "Immediately precedes" means only whitespace (and possibly other blank lines)
 * between the comment end and the node start.
 *
 * @param ast - The full program (contains all comments).
 * @param node - The AST node to search for.
 * @param source - Raw source text (used to check whitespace gap).
 * @returns The JSDoc comment value (content between `/*` and `* /`) or `null`.
 */
function findLeadingJsdoc(
	ast: TSESTree.Program,
	node: TSESTree.Node,
	source: string,
): string | null {
	const comments = ast.comments ?? [];
	const nodeStart = node.range?.[0] ?? 0;

	// Scan comments in reverse to find the nearest one before the node
	for (let i = comments.length - 1; i >= 0; i--) {
		const comment = comments[i];
		if (!comment || comment.type !== "Block") continue;
		if (!comment.value.startsWith("*")) continue; // must be /** ... */

		const commentEnd = comment.range?.[1] ?? 0;
		if (commentEnd > nodeStart) continue;

		// Ensure only whitespace between comment and node
		const gap = source.slice(commentEnd, nodeStart);
		if (/^\s*$/.test(gap)) {
			return comment.value;
		}
		// Found a non-jsdoc gap — stop searching
		break;
	}

	return null;
}

/**
 * Extract the first descriptive sentence from a JSDoc comment value.
 *
 * Strips `*` prefixes, removes `@tag` lines, and returns the first non-empty
 * line of prose.
 *
 * @param jsdoc - The raw content of a `/** * /` comment (between delimiters).
 * @returns The first sentence or `""`.
 */
function extractFirstSentence(jsdoc: string): string {
	if (!jsdoc) return "";

	const lines = jsdoc
		.split("\n")
		.map((line) => line.replace(/^\s*\*+\s?/, "").trim())
		.filter((line) => line.length > 0 && !line.startsWith("@"));

	return lines[0] ?? "";
}

// ---------------------------------------------------------------------------
// Internal: signature extraction
// ---------------------------------------------------------------------------

/**
 * Extract the declaration header (signature) from source text.
 *
 * Takes the text from `start` up to the first `{` or `;`, truncated to
 * {@link MAX_SIGNATURE_CHARS} characters. Collapses internal whitespace.
 *
 * @param source - The full source text.
 * @param start - Start offset of the declaration.
 * @param end - End offset of the declaration (unused but kept for future use).
 * @returns Cleaned-up declaration header string.
 */
function extractSignature(source: string, start: number, _end: number): string {
	const chunk = source.slice(start, start + MAX_SIGNATURE_CHARS + 50);
	let headerEnd = chunk.length;

	const braceIdx = chunk.indexOf("{");
	const semiIdx = chunk.indexOf(";");

	if (braceIdx >= 0 && braceIdx < headerEnd) headerEnd = braceIdx;
	if (semiIdx >= 0 && semiIdx < headerEnd) headerEnd = semiIdx;

	const raw = chunk.slice(0, headerEnd).trim().replace(/\s+/g, " ");
	return raw.length > MAX_SIGNATURE_CHARS ? raw.slice(0, MAX_SIGNATURE_CHARS) + "…" : raw;
}

// ---------------------------------------------------------------------------
// Internal: helpers
// ---------------------------------------------------------------------------

/**
 * Resolved `@ai-*` overrides for a symbol, merged with auto-extracted defaults.
 *
 * `surface` and `tags` always have a value; `summary` is the override when
 * present, otherwise the first sentence of the JSDoc (possibly `""`).
 */
interface SymbolOverrides {
	readonly surface: SymbolSurface;
	readonly summary: string;
	readonly tags: readonly string[];
	readonly layerHint?: 0 | 1 | 2;
}

/**
 * Parse the leading JSDoc into the effective symbol metadata, applying any
 * `@ai-*` overrides on top of the auto-extracted summary.
 *
 * @param jsdoc - The leading JSDoc comment body, or `null` if none.
 * @returns The merged overrides for the symbol.
 */
function resolveOverrides(jsdoc: string | null): SymbolOverrides {
	const block = jsdoc ?? "";
	const ann = annotationParser.parse(block);
	const base: SymbolOverrides = {
		surface: ann.surface ?? "public",
		summary: ann.summary ?? extractFirstSentence(block),
		tags: ann.tags,
	};
	// `layerHint` is parsed and surfaced now; consumed by layered loading in Chunk 15.
	return ann.layerHint === undefined ? base : { ...base, layerHint: ann.layerHint };
}

/**
 * Construct a `ParsedSymbol`, applying resolved `@ai-*` overrides.
 *
 * @param name - Symbol name.
 * @param signature - Declaration header.
 * @param line - 1-based source line.
 * @param overrides - Resolved surface/summary/tags from {@link resolveOverrides}.
 * @returns The parsed symbol.
 */
function makeSymbol(
	name: string,
	signature: string,
	line: number,
	overrides: SymbolOverrides,
): ParsedSymbol {
	return {
		name,
		surface: overrides.surface,
		summary: overrides.summary,
		signature,
		line,
		tags: overrides.tags,
	};
}

/**
 * Return an empty `ParsedFile` for unsupported or unreadable files.
 *
 * @param filePath - The file path.
 * @param source - The source string (used for token cost estimation).
 * @returns An empty extraction result.
 */
function emptyParsedFile(filePath: string, source: string): ParsedFile {
	return {
		path: filePath,
		moduleSummary: "",
		exports: [],
		tokenCost: TokenCounter.heuristicCount(source),
		tokenCostAccurate: false,
	};
}
