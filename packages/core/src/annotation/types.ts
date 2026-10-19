/**
 * Types for the ai-index auto-extraction system.
 *
 * These types represent the in-memory model for extracted TypeScript/JS symbols
 * and the serialized ai-index.yaml format.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Parsed (extracted) types — in-memory, pre-index
// ---------------------------------------------------------------------------

/**
 * Visibility surface of an exported symbol.
 * - `"public"` — part of the stable API surface (default for all exports)
 * - `"private"` — exported for technical reasons but not intended for consumers
 *   (set via `@ai-surface private` in 13B)
 */
export type SymbolSurface = "public" | "private";

/**
 * A single exported symbol extracted from a TypeScript/JS file.
 */
export interface ParsedSymbol {
	/** The export name (e.g. `"CliError"`, `"TokenCounter"`). */
	readonly name: string;
	/** Visibility surface. Defaults to `"public"` for all exported symbols. */
	readonly surface: SymbolSurface;
	/** One-line summary auto-extracted from existing `/** * /` JSDoc. Empty if none. */
	readonly summary: string;
	/** Declaration header without the body (e.g. `"export class Foo extends Bar"`). */
	readonly signature: string;
	/** 1-based line number in the source file. */
	readonly line: number;
	/** Extra tags (populated by AnnotationParser in 13B; empty in 13A). */
	readonly tags: readonly string[];
}

/**
 * Extraction result for a single TypeScript/JS file.
 */
export interface ParsedFile {
	/** Absolute path to the file (ValidatedPath-safe string). */
	readonly path: string;
	/** Module-level summary from the `@packageDocumentation` JSDoc block. Empty if none. */
	readonly moduleSummary: string;
	/** All exported symbols found in the file. */
	readonly exports: readonly ParsedSymbol[];
	/** Estimated token cost (heuristic unless `tokenCostAccurate` is true). */
	readonly tokenCost: number;
	/** Whether `tokenCost` came from an accurate external counter. */
	readonly tokenCostAccurate: boolean;
}

// ---------------------------------------------------------------------------
// Index (serialized) types — ai-index.yaml format
// ---------------------------------------------------------------------------

/**
 * A single symbol entry in the ai-index.
 * Mirror of `ParsedSymbol` but stripped of intermediate extraction data.
 */
export interface SymbolEntry {
	/** Visibility surface. */
	readonly surface: SymbolSurface;
	/** One-line summary. */
	readonly summary: string;
	/** Declaration header without body. */
	readonly signature: string;
	/** 1-based line number. */
	readonly line: number;
	/** Extra `@ai-*` tags (empty in 13A). */
	readonly tags: readonly string[];
}

/**
 * A file entry in the ai-index.
 */
export interface FileEntry {
	/** Module-level summary. */
	readonly module_summary: string;
	/**
	 * Default context layer for this file.
	 * - `0` — module summary + public symbol names only
	 * - `1` — signatures (no implementation)
	 * - `2` — full source
	 */
	readonly layer_default: 0 | 1 | 2;
	/** Estimated or accurate token cost. */
	readonly token_cost: number;
	/** Whether `token_cost` is accurate (external counter) or heuristic. */
	readonly token_cost_accurate: boolean;
	/** Exported symbols keyed by name. */
	readonly exports: Readonly<Record<string, SymbolEntry>>;
}

/**
 * The full ai-index structure (maps to `.session/ai-index.yaml`).
 */
export interface AiIndex {
	/** Schema version. Always `"2"` for v2. */
	readonly version: "2";
	/** ISO 8601 timestamp when the index was last generated. */
	readonly generated_at: string;
	/** Absolute project root path at index time. */
	readonly project_root: string;
	/** All indexed files, keyed by relative path from project root. */
	readonly files: Readonly<Record<string, FileEntry>>;
}
