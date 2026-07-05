/**
 * AiIndexManager — load, save, query, and render the ai-index.
 *
 * Handles disk I/O (atomic write + SecretScanner), and provides query/render
 * methods used by the CLI and MCP server.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, ParseError, PathValidator } from "@dev-session/security";
import type { FileIndexEntry } from "../schemas/index.js";
import { AI_INDEX_FILENAME, AiIndexBuilder } from "./ai-index-builder.js";
import type { AiIndex, FileEntry } from "./types.js";

// ---------------------------------------------------------------------------
// AiIndexManager
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of the ai-index on disk and provides query/render APIs.
 */
export const AiIndexManager = {
	/**
	 * Load the ai-index from `.session/ai-index.yaml` in the project root.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @returns The loaded `AiIndex`, or `null` if the file does not exist.
	 * @throws {ParseError} If the file exists but cannot be parsed.
	 */
	load(sessionDir: ValidatedPath): AiIndex | null {
		const indexPath = path.join(sessionDir, AI_INDEX_FILENAME);
		if (!fs.existsSync(indexPath)) {
			return null;
		}

		let content: string;
		try {
			content = fs.readFileSync(indexPath, "utf-8");
		} catch (cause: unknown) {
			throw new ParseError({
				message: "Failed to read ai-index.yaml",
				file: ".session/ai-index.yaml",
				cause,
			});
		}

		return AiIndexBuilder.deserialize(content);
	},

	/**
	 * Save an `AiIndex` to `.session/ai-index.yaml` atomically.
	 *
	 * The content is scanned for secrets before writing. In strict mode, the
	 * write is blocked if secrets are found; otherwise a warning is logged.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @param index - The index to save.
	 * @param strict - Block on secret detection (default: false = warn only).
	 * @throws {SecurityError} If strict mode is enabled and secrets are found.
	 */
	save(sessionDir: ValidatedPath, index: AiIndex, strict = false): void {
		const content = AiIndexBuilder.serialize(index);
		const indexPath = PathValidator.safeResolvePath(AI_INDEX_FILENAME, sessionDir);

		AtomicWriter.writeFile(indexPath, content, {
			guard: { strict },
		});
	},

	// Query methods

	/**
	 * Return file entries whose `layer_default` matches the given layer.
	 *
	 * @param index - The index to query.
	 * @param layer - Layer to filter by (0, 1, or 2).
	 * @returns Object mapping relative path → FileEntry.
	 */
	queryByLayer(index: AiIndex, layer: 0 | 1 | 2): Record<string, FileEntry> {
		const result: Record<string, FileEntry> = Object.create(null) as Record<string, FileEntry>;
		for (const [relPath, entry] of Object.entries(index.files)) {
			if (entry.layer_default === layer) {
				result[relPath] = entry;
			}
		}
		return result;
	},

	/**
	 * Return file entries where at least one symbol has the given `@ai-*` tag.
	 *
	 * @param index - The index to query.
	 * @param tag - Tag string to search for (e.g. `"@ai-surface=private"`).
	 * @returns Object mapping relative path → FileEntry.
	 */
	queryByTag(index: AiIndex, tag: string): Record<string, FileEntry> {
		const result: Record<string, FileEntry> = Object.create(null) as Record<string, FileEntry>;
		for (const [relPath, entry] of Object.entries(index.files)) {
			const hasTag = Object.values(entry.exports).some((sym) => sym.tags.includes(tag));
			if (hasTag) {
				result[relPath] = entry;
			}
		}
		return result;
	},

	/**
	 * Return file entries whose path is tagged to the given chunk in FILE_INDEX.
	 *
	 * Cross-references the ai-index with FILE_INDEX entries to find files
	 * belonging to a specific work chunk.
	 *
	 * @param index - The ai-index.
	 * @param chunkId - Numeric chunk ID to look up.
	 * @param fileIndex - FILE_INDEX entries to cross-reference.
	 * @returns Object mapping relative path → FileEntry.
	 */
	queryByChunk(
		index: AiIndex,
		chunkId: number,
		fileIndex: readonly FileIndexEntry[],
	): Record<string, FileEntry> {
		// Build a set of paths tagged to the chunk
		const taggedPaths = new Set<string>();
		for (const entry of fileIndex) {
			if (entry.chunk_tags.includes(chunkId)) {
				taggedPaths.add(entry.filepath);
			}
		}

		const result: Record<string, FileEntry> = Object.create(null) as Record<string, FileEntry>;
		for (const [relPath, entry] of Object.entries(index.files)) {
			if (taggedPaths.has(relPath)) {
				result[relPath] = entry;
			}
		}
		return result;
	},

	// Render methods

	/**
	 * Render a file entry at Layer 0: module summary + public symbol names only.
	 *
	 * This is the most compact representation, suitable for always-loaded context.
	 *
	 * @param relPath - Relative file path (used as a header).
	 * @param entry - The file entry to render.
	 * @returns A short plain-text block.
	 */
	renderLayer0(relPath: string, entry: FileEntry): string {
		const lines: string[] = [`## ${relPath}`];

		if (entry.module_summary) {
			lines.push(entry.module_summary);
		}

		const publicSymbols = Object.entries(entry.exports)
			.filter(([, sym]) => sym.surface === "public")
			.map(([name]) => name)
			.sort();

		if (publicSymbols.length > 0) {
			lines.push(`Exports: ${publicSymbols.join(", ")}`);
		}

		return lines.join("\n");
	},

	/**
	 * Render a file entry at Layer 1: signatures only (no implementation).
	 *
	 * Includes module summary and the declaration header of each public symbol.
	 *
	 * @param relPath - Relative file path (used as a header).
	 * @param entry - The file entry to render.
	 * @returns A medium-length plain-text block with signatures.
	 */
	renderLayer1(relPath: string, entry: FileEntry): string {
		const lines: string[] = [`## ${relPath}`];

		if (entry.module_summary) {
			lines.push(entry.module_summary);
		}

		const publicSymbols = Object.entries(entry.exports)
			.filter(([, sym]) => sym.surface === "public")
			.sort(([a], [b]) => a.localeCompare(b));

		for (const [, sym] of publicSymbols) {
			const summaryPart = sym.summary ? ` — ${sym.summary}` : "";
			lines.push(`  ${sym.signature}${summaryPart}`);
		}

		return lines.join("\n");
	},

	/**
	 * Render a file at Layer 2: full source content.
	 *
	 * Reads the file from disk. Caller is responsible for path validation.
	 *
	 * @param absolutePath - Validated absolute path to the file.
	 * @returns The full file content.
	 * @throws {ParseError} If the file cannot be read.
	 */
	renderLayer2(absolutePath: ValidatedPath): string {
		try {
			return fs.readFileSync(absolutePath, "utf-8");
		} catch (cause: unknown) {
			throw new ParseError({
				message: "Failed to read file for Layer 2 render",
				file: absolutePath,
				cause,
			});
		}
	},

	// Stats

	/**
	 * Count files and public symbols in the index.
	 *
	 * @param index - The index to count.
	 * @returns `{ fileCount, symbolCount, totalTokenCost }`.
	 */
	stats(index: AiIndex): { fileCount: number; symbolCount: number; totalTokenCost: number } {
		let symbolCount = 0;
		let totalTokenCost = 0;

		for (const entry of Object.values(index.files)) {
			symbolCount += Object.values(entry.exports).filter((sym) => sym.surface === "public").length;
			totalTokenCost += entry.token_cost;
		}

		return {
			fileCount: Object.keys(index.files).length,
			symbolCount,
			totalTokenCost,
		};
	},
} as const;
