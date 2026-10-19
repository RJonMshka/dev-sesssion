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
 * What kind of declaration a code unit is.
 */
export type UnitKind = "function" | "class" | "method" | "variable" | "type" | "interface" | "enum";

/**
 * An addressable piece of a source file — a top-level declaration, or a method
 * of a top-level class or object literal (LLD-code-units.md).
 *
 * Units are what a prompt can focus on instead of escalating a whole file.
 */
export interface ParsedUnit {
	/**
	 * Unique within the file: the declared name, `Parent.member` for a member,
	 * `~n` appended to repeats (overloads, merged declarations).
	 */
	readonly id: string;
	/** Declaration kind. */
	readonly kind: UnitKind;
	/** First line, 1-based inclusive; the attached JSDoc block when present. */
	readonly start: number;
	/** Last line, 1-based inclusive. */
	readonly end: number;
	/** Heuristic token cost of the range. */
	readonly tokens: number;
	/** Content hash of the range, per the PROTOCOL.md contract. */
	readonly hash: string;
	/** Whether the unit (or, for a member, its parent) is exported. */
	readonly exported: boolean;
	/**
	 * References in the unit's own file that certainly bind to it, outside its
	 * own lines (REQ-UNIT-31). 0 when an inner binding could capture the name.
	 */
	readonly refs: number;
}

/**
 * A relative import or re-export resolved to an existing file (REQ-UNIT-31).
 */
export interface ParsedImport {
	/** The imported file: absolute in a `ParsedFile`, repo-relative in the index. */
	readonly from: string;
	/** The name on the exporting side; `*` for a namespace, `default` for a default import. */
	readonly name: string;
	/** The name bound in the importing file (the exported name, for a re-export). */
	readonly local: string;
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
	/** Every code unit in the file, in source order. Empty when unparseable. */
	readonly units: readonly ParsedUnit[];
	/** Content hash of the whole file, per the PROTOCOL.md contract. */
	readonly hash: string;
	/** Relative imports and re-exports resolved to existing files. */
	readonly imports: readonly ParsedImport[];
	/** `local.prop` accesses through imported bindings, sorted and unique. */
	readonly memberRefs: readonly string[];
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
 * A code unit as stored in the ai-index, keyed by its id under
 * {@link FileEntry.units}. Structure only — no signature or summary.
 */
export interface UnitEntry {
	/** Declaration kind. */
	readonly kind: UnitKind;
	/** First line, 1-based inclusive. */
	readonly start: number;
	/** Last line, 1-based inclusive. */
	readonly end: number;
	/** Heuristic token cost of the range. */
	readonly tokens: number;
	/** Content hash of the range. */
	readonly hash: string;
	/** Whether the unit is exported. */
	readonly exported: boolean;
	/** Certain in-file references (REQ-UNIT-31). Absent in older indexes: no evidence. */
	readonly refs?: number;
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
	/**
	 * Every code unit keyed by id. Absent in indexes written before code units
	 * existed, which still load (REQ-UNIT-6).
	 */
	readonly units?: Readonly<Record<string, UnitEntry>>;
	/** Content hash of the whole file. Absent in older indexes. */
	readonly hash?: string;
	/** Resolved relative imports, `from` repo-relative. Absent in older indexes. */
	readonly imports?: readonly ParsedImport[];
	/** `local.prop` accesses through imported bindings. Absent in older indexes. */
	readonly member_refs?: readonly string[];
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
