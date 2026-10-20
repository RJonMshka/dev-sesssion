/**
 * AiIndexBuilder — builds, merges, and serializes the ai-index.
 *
 * Responsibilities:
 * - `build`: converts `ParsedFile[]` to a full `AiIndex`
 * - `merge`: merges an existing index with a partial update (mtime-based incremental)
 * - `serialize`: deterministic YAML output (sorted keys)
 * - `deserialize`: parses YAML back to `AiIndex`
 *
 * @packageDocumentation
 */

import type { ValidatedPath } from "@dev-session/security";
import { ParseError } from "@dev-session/security";
import { AutoExtractor } from "./auto-extractor.js";
import type {
	AiIndex,
	FileEntry,
	ParsedFile,
	ParsedImport,
	SymbolEntry,
	UnitEntry,
	UnitKind,
} from "./types.js";
import { isUnitId } from "./unit-extractor.js";
import { deserializeFromYaml, serializeToYaml } from "./yaml-utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ai-index schema version. */
const INDEX_VERSION = "2" as const;

/** Filename written to .session/. */
export const AI_INDEX_FILENAME = "ai-index.yaml";

// ---------------------------------------------------------------------------
// AiIndexBuilder
// ---------------------------------------------------------------------------

/**
 * Builds, merges, and (de)serializes the ai-index.
 *
 * All methods are static — no instance state required.
 */
export const AiIndexBuilder = {
	/**
	 * Build a full `AiIndex` from an array of extracted files.
	 *
	 * @param files - Extraction results from `AutoExtractor`.
	 * @param projectRoot - Absolute path to the project root.
	 * @param tokenCosts - Optional accurate token cost overrides by relative path.
	 *   When provided for a file, overrides `ParsedFile.tokenCost`.
	 * @returns A freshly built `AiIndex`.
	 */
	build(
		files: readonly ParsedFile[],
		projectRoot: string,
		tokenCosts?: Readonly<Record<string, number>>,
	): AiIndex {
		const fileEntries: Record<string, FileEntry> = Object.create(null) as Record<string, FileEntry>;

		for (const file of files) {
			// Compute a relative path key: strip the root prefix
			const relPath = toRelativePath(file.path, projectRoot);
			const overrideCost = tokenCosts?.[relPath];
			const tokenCost = overrideCost ?? file.tokenCost;
			const accurate = overrideCost !== undefined ? true : file.tokenCostAccurate;

			const exportsMap: Record<string, SymbolEntry> = Object.create(null) as Record<
				string,
				SymbolEntry
			>;
			for (const sym of file.exports) {
				exportsMap[sym.name] = {
					surface: sym.surface,
					summary: sym.summary,
					signature: sym.signature,
					line: sym.line,
					tags: [...sym.tags],
				};
			}

			fileEntries[relPath] = {
				module_summary: file.moduleSummary,
				layer_default: 1,
				token_cost: tokenCost,
				token_cost_accurate: accurate,
				exports: exportsMap,
				units: buildUnitsMap(file),
				hash: file.hash,
				imports: relativeImports(file.imports, projectRoot),
				member_refs: [...file.memberRefs],
			};
		}

		return {
			version: INDEX_VERSION,
			generated_at: new Date().toISOString(),
			project_root: projectRoot,
			files: fileEntries,
		};
	},

	/**
	 * Extract every TypeScript/JS file under `root` and build a full index.
	 *
	 * Shared by `init` and `index`, so the two cannot build different indexes
	 * for the same tree (LLD-first-run.md, REQ-RUN-10). `maxFiles` caps
	 * extraction the way `init --max-files` caps the file index (REQ-RUN-12).
	 *
	 * @param root - Validated absolute path to the project root.
	 * @param opts - Optional extraction cap.
	 * @returns A freshly built `AiIndex`.
	 * @throws {ParseError} If the directory cannot be walked.
	 */
	async fromDirectory(root: ValidatedPath, opts?: { maxFiles?: number }): Promise<AiIndex> {
		const files = await new AutoExtractor().extractDirectory(
			root,
			opts?.maxFiles !== undefined ? { maxFiles: opts.maxFiles } : undefined,
		);
		return AiIndexBuilder.build(files, root);
	},

	/**
	 * Merge an existing index with a partial update.
	 *
	 * The `updated` index is the source of truth for all files it contains.
	 * Files present in `existing` but absent from `updated` are dropped
	 * (they were deleted or explicitly excluded from the re-scan).
	 *
	 * The CLI `index --update` command is responsible for:
	 * 1. Loading `existing` from disk.
	 * 2. Walking the directory to find all current files.
	 * 3. Re-extracting only files whose mtime changed.
	 * 4. Building `updated` with: changed files (fresh entry) + unchanged files
	 *    (entry copied from `existing`).
	 * 5. Calling `merge(existing, updated)` to get the final index.
	 *
	 * @param existing - The previous index (loaded from disk).
	 * @param updated - The new partial or full index (only changed files rebuilt).
	 * @returns The merged index with a refreshed `generated_at` timestamp.
	 */
	merge(existing: AiIndex, updated: AiIndex): AiIndex {
		return {
			version: INDEX_VERSION,
			generated_at: new Date().toISOString(),
			project_root: existing.project_root,
			files: { ...updated.files },
		};
	},

	/**
	 * Serialize an `AiIndex` to a deterministic YAML string.
	 *
	 * Keys are sorted alphabetically at every level. The output is byte-for-byte
	 * identical given the same input, enabling stable git diffs.
	 *
	 * @param index - The index to serialize.
	 * @returns Valid YAML string ending with `\n`.
	 */
	serialize(index: AiIndex): string {
		// Cast to plain object for the YAML serializer
		const data: Record<string, unknown> = {
			version: index.version,
			generated_at: index.generated_at,
			project_root: index.project_root,
			files: buildSerializableFiles(index.files),
		};
		return serializeToYaml(data);
	},

	/**
	 * Deserialize an `AiIndex` from a YAML string produced by {@link serialize}.
	 *
	 * @param content - The YAML content to parse.
	 * @returns The parsed `AiIndex`.
	 * @throws {ParseError} If the content is malformed or missing required fields.
	 */
	deserialize(content: string): AiIndex {
		let raw: Record<string, unknown>;
		try {
			raw = deserializeFromYaml(content);
		} catch (cause: unknown) {
			throw new ParseError({
				message: "Failed to parse ai-index.yaml: invalid YAML",
				file: ".session/ai-index.yaml",
				cause,
			});
		}

		if (raw.version !== "2") {
			throw new ParseError({
				message: `Unsupported ai-index version: ${String(raw.version)} (expected "2")`,
				file: ".session/ai-index.yaml",
			});
		}

		const files = parseFiles(raw.files);

		return {
			version: "2",
			generated_at: typeof raw.generated_at === "string" ? raw.generated_at : "",
			project_root: typeof raw.project_root === "string" ? raw.project_root : "",
			files,
		};
	},
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a `ParsedFile.path` (absolute) to a relative path for the index key.
 *
 * @param absPath - Absolute file path.
 * @param projectRoot - Absolute project root.
 * @returns Relative path with forward slashes.
 */
function toRelativePath(absPath: string, projectRoot: string): string {
	const root = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`;
	if (absPath.startsWith(root)) {
		return absPath.slice(root.length);
	}
	// Fallback: return as-is (shouldn't happen in normal usage)
	return absPath;
}

/**
 * Build a plain-object representation of the files map suitable for YAML serialization.
 *
 * @param files - The files map from `AiIndex`.
 * @returns A plain object with the same shape.
 */
function buildSerializableFiles(
	files: Readonly<Record<string, FileEntry>>,
): Record<string, unknown> {
	const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const [relPath, entry] of Object.entries(files)) {
		const exportsObj: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const [name, sym] of Object.entries(entry.exports)) {
			exportsObj[name] = {
				line: sym.line,
				signature: sym.signature,
				summary: sym.summary,
				surface: sym.surface,
				tags: [...sym.tags],
			};
		}
		out[relPath] = {
			exports: exportsObj,
			layer_default: entry.layer_default,
			module_summary: entry.module_summary,
			token_cost: entry.token_cost,
			token_cost_accurate: entry.token_cost_accurate,
			// Optional keys are omitted, not written as null, so an index without
			// units serializes byte-for-byte as it did before units existed.
			...(entry.units !== undefined ? { units: { ...entry.units } } : {}),
			...(entry.hash !== undefined ? { hash: entry.hash } : {}),
			...(entry.imports !== undefined ? { imports: entry.imports.map((i) => ({ ...i })) } : {}),
			...(entry.member_refs !== undefined ? { member_refs: [...entry.member_refs] } : {}),
		};
	}
	return out;
}

/**
 * Parse the `files` section from the raw deserialized YAML object.
 *
 * @param raw - The raw `files` value from YAML parsing.
 * @returns A typed `Record<string, FileEntry>`.
 */
function parseFiles(raw: unknown): Record<string, FileEntry> {
	if (typeof raw !== "object" || raw === null)
		return Object.create(null) as Record<string, FileEntry>;

	const result: Record<string, FileEntry> = Object.create(null) as Record<string, FileEntry>;

	for (const [relPath, entryRaw] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof entryRaw !== "object" || entryRaw === null) continue;
		const entry = entryRaw as Record<string, unknown>;

		const exportsRaw = entry.exports;
		const exportsMap: Record<string, SymbolEntry> = Object.create(null) as Record<
			string,
			SymbolEntry
		>;

		if (typeof exportsRaw === "object" && exportsRaw !== null) {
			for (const [name, symRaw] of Object.entries(exportsRaw as Record<string, unknown>)) {
				if (typeof symRaw !== "object" || symRaw === null) continue;
				const sym = symRaw as Record<string, unknown>;
				exportsMap[name] = {
					surface: (sym.surface as "public" | "private") ?? "public",
					summary: typeof sym.summary === "string" ? sym.summary : "",
					signature: typeof sym.signature === "string" ? sym.signature : "",
					line: typeof sym.line === "number" ? sym.line : 0,
					tags: Array.isArray(sym.tags) ? (sym.tags as string[]) : [],
				};
			}
		}

		const layerRaw = entry.layer_default;
		const layer: 0 | 1 | 2 = layerRaw === 0 || layerRaw === 1 || layerRaw === 2 ? layerRaw : 1;

		const units = parseUnits(entry.units);
		result[relPath] = {
			module_summary: typeof entry.module_summary === "string" ? entry.module_summary : "",
			layer_default: layer,
			token_cost: typeof entry.token_cost === "number" ? entry.token_cost : 0,
			token_cost_accurate:
				typeof entry.token_cost_accurate === "boolean" ? entry.token_cost_accurate : false,
			exports: exportsMap,
			...(units !== undefined ? { units } : {}),
			...(typeof entry.hash === "string" ? { hash: entry.hash } : {}),
			...parseUsage(entry),
		};
	}

	return result;
}

/**
 * Convert a file's extracted units into the index's id-keyed map.
 *
 * @param file - The extraction result.
 * @returns Units keyed by id.
 */
function buildUnitsMap(file: ParsedFile): Record<string, UnitEntry> {
	const units: Record<string, UnitEntry> = Object.create(null) as Record<string, UnitEntry>;
	for (const u of file.units) {
		units[u.id] = {
			kind: u.kind,
			start: u.start,
			end: u.end,
			tokens: u.tokens,
			hash: u.hash,
			exported: u.exported,
			refs: u.refs,
		};
	}
	return units;
}

/**
 * Converts resolved imports to repo-relative paths, dropping any outside the
 * project — the index never records an absolute path.
 *
 * @param imports - Imports with absolute `from`.
 * @param projectRoot - Absolute project root.
 * @returns Imports with relative `from`.
 */
function relativeImports(imports: readonly ParsedImport[], projectRoot: string): ParsedImport[] {
	const root = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`;
	return imports
		.filter((i) => i.from.startsWith(root))
		.map((i) => ({ from: i.from.slice(root.length), name: i.name, local: i.local }));
}

/**
 * Whether a value is a well-formed serialized import.
 *
 * @param v - Anything.
 * @returns True for `{ from, name, local }` strings.
 */
function isImport(v: unknown): v is ParsedImport {
	if (typeof v !== "object" || v === null) return false;
	const i = v as Record<string, unknown>;
	return typeof i.from === "string" && typeof i.name === "string" && typeof i.local === "string";
}

/**
 * Parses a file entry's optional usage facts (REQ-UNIT-31). Malformed rows are
 * dropped: missing evidence makes the resolver refuse, wrong evidence would not.
 *
 * @param entry - The raw file entry.
 * @returns The `imports` and `member_refs` present.
 */
function parseUsage(entry: Record<string, unknown>): Pick<FileEntry, "imports" | "member_refs"> {
	const out: { imports?: ParsedImport[]; member_refs?: string[] } = {};
	if (Array.isArray(entry.imports)) out.imports = entry.imports.filter(isImport);
	if (Array.isArray(entry.member_refs)) {
		out.member_refs = entry.member_refs.filter((r): r is string => typeof r === "string");
	}
	return out;
}

/** Every unit kind the reader accepts. */
const UNIT_KINDS: ReadonlySet<string> = new Set<UnitKind>([
	"function",
	"class",
	"method",
	"variable",
	"type",
	"interface",
	"enum",
]);

/**
 * Parse one serialized unit row, rejecting any field of the wrong shape.
 *
 * A malformed row is dropped rather than repaired: a unit with an invented
 * range would point a prompt at the wrong lines.
 *
 * @param raw - The raw row.
 * @returns The unit, or `null` when any field is malformed.
 */
function parseUnit(raw: unknown): UnitEntry | null {
	if (typeof raw !== "object" || raw === null) return null;
	const u = raw as Record<string, unknown>;
	const { kind, start, end, tokens, hash, exported } = u;
	if (typeof kind !== "string" || !UNIT_KINDS.has(kind)) return null;
	if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(tokens)) return null;
	if (typeof hash !== "string" || typeof exported !== "boolean") return null;
	return {
		kind: kind as UnitKind,
		start: start as number,
		end: end as number,
		tokens: tokens as number,
		hash,
		exported,
		...(Number.isInteger(u.refs) ? { refs: u.refs as number } : {}),
	};
}

/**
 * Parse a file entry's `units` map, when present (REQ-UNIT-6).
 *
 * @param raw - The raw `units` value.
 * @returns Units keyed by id, or `undefined` when the entry has none.
 */
function parseUnits(raw: unknown): Record<string, UnitEntry> | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const units: Record<string, UnitEntry> = Object.create(null) as Record<string, UnitEntry>;
	for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
		// An id is printed on the prompt's Focus line, so one that is not
		// name-shaped is dropped like any other malformed row (REQ-PROV-10).
		if (!isUnitId(id)) continue;
		const unit = parseUnit(row);
		if (unit !== null) units[id] = unit;
	}
	return units;
}
