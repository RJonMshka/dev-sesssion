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

import { ParseError } from "@dev-session/security";
import type { AiIndex, FileEntry, ParsedFile, SymbolEntry } from "./types.js";
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

		result[relPath] = {
			module_summary: typeof entry.module_summary === "string" ? entry.module_summary : "",
			layer_default: layer,
			token_cost: typeof entry.token_cost === "number" ? entry.token_cost : 0,
			token_cost_accurate:
				typeof entry.token_cost_accurate === "boolean" ? entry.token_cost_accurate : false,
			exports: exportsMap,
		};
	}

	return result;
}
