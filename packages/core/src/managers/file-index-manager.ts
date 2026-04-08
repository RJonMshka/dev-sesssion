/**
 * Manages reading, writing, querying, and auditing the FILE_INDEX.md file.
 *
 * FILE_INDEX.md maps file paths to plan chunks, enabling selective context loading.
 * The file uses a markdown table format grouped by chunk sections.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, ParseError } from "@dev-session/security";

import type { AuditResult, FileIndexEntry } from "../schemas/index.js";

/** The filename for the file index within the session directory. */
const FILE_INDEX_FILENAME = "FILE_INDEX.md";

/**
 * Maximum entries per page when pagination is enabled.
 * Repos exceeding this threshold use FILE_INDEX_1.md, FILE_INDEX_2.md, etc.
 */
export const FILE_INDEX_PAGE_SIZE = 500;

/** Pattern matching "## Chunk N" or "## Chunk N — Title" headings. */
const CHUNK_HEADING_PATTERN = /^##\s+Chunk\s+(\d+)(\s|$)/;

/** Pattern matching "## Always Include" heading. */
const ALWAYS_INCLUDE_HEADING = /^##\s+Always\s+Include\s*$/;

/** Pattern matching table separator rows like `|---|---|`. */
const TABLE_SEPARATOR_PATTERN = /^\|\s*-+\s*\|\s*-+\s*\|$/;

/** Pattern matching table header rows like `| File | Purpose |`. */
const TABLE_HEADER_PATTERN = /^\|\s*File\s*\|\s*Purpose\s*\|$/;

/**
 * Manages the FILE_INDEX.md file — loading, saving, querying, and auditing entries.
 *
 * All methods that touch the filesystem accept `ValidatedPath` arguments.
 * Pure query functions operate on in-memory `FileIndexEntry[]` arrays.
 */
export const FileIndexManager = {
	/**
	 * Loads and parses FILE_INDEX.md from the given session directory.
	 *
	 * When `FILE_INDEX_1.md` exists alongside `FILE_INDEX.md`, all pages
	 * (`FILE_INDEX_1.md`, `FILE_INDEX_2.md`, …) are loaded and merged.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @returns An array of parsed file index entries.
	 * @throws {ParseError} If the file cannot be read or contains malformed content.
	 */
	load(sessionDir: ValidatedPath): FileIndexEntry[] {
		// Detect paginated layout: FILE_INDEX_1.md exists
		if (fs.existsSync(path.join(sessionDir, "FILE_INDEX_1.md"))) {
			return loadPaginatedIndex(sessionDir);
		}
		const filePath = path.join(sessionDir, FILE_INDEX_FILENAME);
		const relativePath = path.relative(process.cwd(), filePath);
		const content = readFileContent(filePath, relativePath);
		return parseFileIndex(content, relativePath);
	},

	/**
	 * Serializes file index entries and writes them atomically.
	 *
	 * When `entries.length > FILE_INDEX_PAGE_SIZE`, the index is split into
	 * `FILE_INDEX_1.md`, `FILE_INDEX_2.md`, … pages and a stub `FILE_INDEX.md`
	 * is written. Existing page files are cleaned up if the page count shrinks.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @param entries - The file index entries to serialize and write.
	 * @throws {Error} If the atomic write fails.
	 */
	save(sessionDir: ValidatedPath, entries: readonly FileIndexEntry[]): void {
		if (entries.length > FILE_INDEX_PAGE_SIZE) {
			savePaginatedIndex(sessionDir, entries);
			return;
		}
		// Remove any leftover page files (e.g. after entries shrink)
		cleanPageFiles(sessionDir);
		// sessionDir is already validated by the caller; filename is a constant.
		const filePath = path.join(sessionDir, FILE_INDEX_FILENAME) as ValidatedPath;
		AtomicWriter.writeFile(filePath, serializeEntries(entries));
	},

	/**
	 * Returns all entries that belong to a given chunk.
	 *
	 * @param entries - The full set of file index entries.
	 * @param chunkId - The chunk ID to filter by.
	 * @returns Entries whose `chunk_tags` include `chunkId`.
	 */
	queryByChunk(entries: readonly FileIndexEntry[], chunkId: number): FileIndexEntry[] {
		return entries.filter((entry) => entry.chunk_tags.includes(chunkId));
	},

	/**
	 * Returns all entries tagged with chunk `0` ("Always Include").
	 *
	 * @param entries - The full set of file index entries.
	 * @returns Entries whose `chunk_tags` include `0`.
	 */
	alwaysInclude(entries: readonly FileIndexEntry[]): FileIndexEntry[] {
		return entries.filter((entry) => entry.chunk_tags.includes(0));
	},

	/**
	 * Adds an entry to the list, deduplicating by filepath.
	 *
	 * If a filepath already exists, its `chunk_tags` are merged (union) and the
	 * purpose is updated to the new entry's value.
	 *
	 * @param entries - The existing file index entries.
	 * @param entry - The new entry to add or merge.
	 * @returns A new array with the entry added or merged.
	 */
	add(entries: readonly FileIndexEntry[], entry: FileIndexEntry): FileIndexEntry[] {
		const existingIndex = entries.findIndex((e) => e.filepath === entry.filepath);

		if (existingIndex === -1) {
			return [...entries, entry];
		}

		const existing = entries[existingIndex] as FileIndexEntry;
		const mergedTags = mergeChunkTags(existing.chunk_tags, entry.chunk_tags);
		const merged: FileIndexEntry = {
			filepath: existing.filepath,
			chunk_tags: mergedTags,
			purpose: entry.purpose,
		};

		const result = [...entries];
		result[existingIndex] = merged;
		return result;
	},

	/**
	 * Audits the file index against the filesystem.
	 *
	 * Checks for:
	 * - Stale entries whose files no longer exist on disk
	 * - Chunk IDs that have no corresponding `PLAN_N.md` in the session directory
	 *
	 * @param entries - The file index entries to audit.
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @returns An audit result describing stale entries, missing chunks, and overall health.
	 */
	audit(entries: readonly FileIndexEntry[], sessionDir: ValidatedPath): AuditResult {
		const projectRoot = path.dirname(sessionDir);
		const stale = findStaleEntries(entries, projectRoot);
		const missingChunks = findMissingChunks(entries, sessionDir);
		const healthy = stale.length === 0 && missingChunks.length === 0;

		return { stale, missingChunks, healthy };
	},
} as const;

// ---------------------------------------------------------------------------
// Internal: File I/O
// ---------------------------------------------------------------------------

/**
 * Reads the raw content of FILE_INDEX.md.
 *
 * @param filePath - Absolute path to the file.
 * @param relativePath - Relative path for error messages.
 * @returns The file content as a string.
 * @throws {ParseError} If the file cannot be read.
 */
function readFileContent(filePath: string, relativePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch (cause: unknown) {
		throw new ParseError({
			message: `Cannot read FILE_INDEX.md`,
			file: relativePath,
			cause,
		});
	}
}

// ---------------------------------------------------------------------------
// Internal: Parsing
// ---------------------------------------------------------------------------

/**
 * Parses the full content of FILE_INDEX.md into FileIndexEntry objects.
 *
 * @param content - Raw markdown content.
 * @param relativePath - Relative file path for error messages.
 * @returns Parsed entries.
 * @throws {ParseError} If the content is malformed.
 */
function parseFileIndex(content: string, relativePath: string): FileIndexEntry[] {
	const lines = content.split("\n");
	const entries: FileIndexEntry[] = [];
	let currentChunkTag: number | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;

		const trimmed = line.trim();
		if (trimmed === "") continue;

		const chunkTag = parseSectionHeading(trimmed);
		if (chunkTag !== undefined) {
			currentChunkTag = chunkTag;
			continue;
		}

		if (isTableMetaRow(trimmed)) continue;

		if (isTableDataRow(trimmed) && currentChunkTag !== undefined) {
			const parsed = parseTableRow(trimmed, relativePath, i + 1);
			if (parsed !== undefined) {
				addParsedEntry(entries, parsed.filepath, parsed.purpose, currentChunkTag);
			}
		}
	}

	return entries;
}

/**
 * Parses a section heading to extract the chunk tag.
 *
 * @param line - A trimmed line from the file.
 * @returns The chunk tag number, or `undefined` if this is not a section heading.
 */
function parseSectionHeading(line: string): number | undefined {
	if (ALWAYS_INCLUDE_HEADING.test(line)) {
		return 0;
	}

	const chunkMatch = CHUNK_HEADING_PATTERN.exec(line);
	if (chunkMatch !== null) {
		const rawNumber = chunkMatch[1];
		if (rawNumber !== undefined) {
			const parsed = Number.parseInt(rawNumber, 10);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}
		}
	}

	return undefined;
}

/**
 * Checks whether a line is a table separator or header row.
 *
 * @param line - A trimmed line.
 * @returns `true` if the line is a table meta row that should be skipped.
 */
function isTableMetaRow(line: string): boolean {
	return TABLE_SEPARATOR_PATTERN.test(line) || TABLE_HEADER_PATTERN.test(line);
}

/**
 * Checks whether a line is a table data row (starts with `|`).
 *
 * @param line - A trimmed line.
 * @returns `true` if the line appears to be a data row.
 */
function isTableDataRow(line: string): boolean {
	return line.startsWith("|");
}

/**
 * Parses a single markdown table row into filepath and purpose.
 *
 * @param line - The full table row (e.g., `| foo.ts | Description |`).
 * @param relativePath - Relative file path for error messages.
 * @param lineNumber - The 1-indexed line number for error messages.
 * @returns The parsed filepath and purpose, or `undefined` if the row is malformed.
 * @throws {ParseError} If the row has content but cannot be parsed.
 */
function parseTableRow(
	line: string,
	relativePath: string,
	lineNumber: number,
): { filepath: string; purpose: string } | undefined {
	// Split by `|`, filter out empty segments from leading/trailing pipes
	const cells = line
		.split("|")
		.map((cell) => cell.trim())
		.filter((cell) => cell !== "");

	if (cells.length < 2) {
		throw new ParseError({
			message: `Malformed table row: expected at least 2 columns`,
			file: relativePath,
			line: lineNumber,
		});
	}

	const filepath = cells[0];
	const purpose = cells[1];

	if (filepath === undefined || purpose === undefined) {
		throw new ParseError({
			message: `Malformed table row: missing filepath or purpose`,
			file: relativePath,
			line: lineNumber,
		});
	}

	if (filepath === "" || purpose === "") {
		throw new ParseError({
			message: `Malformed table row: empty filepath or purpose`,
			file: relativePath,
			line: lineNumber,
		});
	}

	return { filepath, purpose };
}

/**
 * Adds a parsed entry to the entries array, merging chunk tags if the filepath already exists.
 *
 * @param entries - The mutable entries array being built.
 * @param filepath - The file's relative path.
 * @param purpose - The file's purpose description.
 * @param chunkTag - The chunk tag from the current section.
 */
function addParsedEntry(
	entries: FileIndexEntry[],
	filepath: string,
	purpose: string,
	chunkTag: number,
): void {
	const existing = entries.find((e) => e.filepath === filepath);

	if (existing !== undefined) {
		if (!existing.chunk_tags.includes(chunkTag)) {
			existing.chunk_tags.push(chunkTag);
		}
	} else {
		entries.push({ filepath, purpose, chunk_tags: [chunkTag] });
	}
}

// ---------------------------------------------------------------------------
// Internal: Serialization
// ---------------------------------------------------------------------------

/**
 * Serializes entries to the FILE_INDEX.md markdown format.
 *
 * @param entries - The entries to serialize.
 * @returns The full markdown content string.
 */
function serializeEntries(entries: readonly FileIndexEntry[]): string {
	const today = new Date().toISOString().slice(0, 10);
	const grouped = groupByChunkTag(entries);
	const sortedChunkIds = [...grouped.keys()].sort((a, b) => a - b);

	const sections: string[] = [buildFrontmatter(today), "# File Index"];

	for (const chunkId of sortedChunkIds) {
		const chunkEntries = grouped.get(chunkId);
		if (chunkEntries === undefined || chunkEntries.length === 0) continue;

		sections.push(buildSectionMarkdown(chunkId, chunkEntries));
	}

	return `${sections.join("\n\n")}\n`;
}

/**
 * Builds the YAML frontmatter block.
 *
 * @param date - The ISO date string for `last_updated`.
 * @returns The frontmatter string.
 */
function buildFrontmatter(date: string): string {
	return `---\nversion: 1\nlast_updated: "${date}"\n---`;
}

/**
 * Builds a single chunk section with heading and table.
 *
 * @param chunkId - The chunk ID (0 = "Always Include").
 * @param entries - The entries for this chunk.
 * @returns The markdown section string.
 */
function buildSectionMarkdown(chunkId: number, entries: readonly FileIndexEntry[]): string {
	const heading = chunkId === 0 ? "## Always Include" : `## Chunk ${String(chunkId)}`;
	const rows = entries.map((entry) => `| ${entry.filepath} | ${entry.purpose} |`);

	return [heading, "", "| File | Purpose |", "|---|---|", ...rows].join("\n");
}

/**
 * Groups entries by their individual chunk tags.
 *
 * A single entry may appear in multiple groups if it has multiple chunk tags.
 *
 * @param entries - The entries to group.
 * @returns A map from chunk ID to entries belonging to that chunk.
 */
function groupByChunkTag(entries: readonly FileIndexEntry[]): Map<number, FileIndexEntry[]> {
	const grouped = new Map<number, FileIndexEntry[]>();

	for (const entry of entries) {
		for (const tag of entry.chunk_tags) {
			let group = grouped.get(tag);
			if (group === undefined) {
				group = [];
				grouped.set(tag, group);
			}
			group.push(entry);
		}
	}

	return grouped;
}

// ---------------------------------------------------------------------------
// Internal: Merging
// ---------------------------------------------------------------------------

/**
 * Merges two chunk_tags arrays into a deduplicated, sorted union.
 *
 * @param existing - The existing chunk tags.
 * @param incoming - The new chunk tags to merge.
 * @returns A sorted array of unique chunk tag values.
 */
function mergeChunkTags(existing: readonly number[], incoming: readonly number[]): number[] {
	const tagSet = new Set([...existing, ...incoming]);
	return [...tagSet].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Internal: Pagination
// ---------------------------------------------------------------------------

/**
 * Load all paginated FILE_INDEX_N.md pages and merge them.
 *
 * @param sessionDir - Validated path to .session/
 * @returns Merged entries from all pages
 * @throws {ParseError} If any page is unreadable
 */
function loadPaginatedIndex(sessionDir: string): FileIndexEntry[] {
	const entries: FileIndexEntry[] = [];
	let page = 1;

	while (true) {
		const pagePath = path.join(sessionDir, `FILE_INDEX_${String(page)}.md`);
		if (!fs.existsSync(pagePath)) break;

		const relativePath = `FILE_INDEX_${String(page)}.md`;
		const content = readFileContent(pagePath, relativePath);
		const pageEntries = parseFileIndex(content, relativePath);
		entries.push(...pageEntries);
		page++;
	}

	return entries;
}

/**
 * Write entries split across multiple FILE_INDEX_N.md page files,
 * then write a stub FILE_INDEX.md indicating the paginated layout.
 *
 * @param sessionDir - Validated path to .session/
 * @param entries - All entries to paginate
 */
function savePaginatedIndex(sessionDir: ValidatedPath, entries: readonly FileIndexEntry[]): void {
	const pageCount = Math.ceil(entries.length / FILE_INDEX_PAGE_SIZE);

	// Remove old page files that exceed the new page count
	cleanPageFiles(sessionDir, pageCount);

	// Write each page
	// sessionDir is already validated by the caller; page filenames are constants.
	for (let i = 0; i < pageCount; i++) {
		const pageEntries = entries.slice(i * FILE_INDEX_PAGE_SIZE, (i + 1) * FILE_INDEX_PAGE_SIZE);
		const pagePath = path.join(sessionDir, `FILE_INDEX_${String(i + 1)}.md`) as ValidatedPath;
		AtomicWriter.writeFile(pagePath, serializeEntries(pageEntries));
	}

	// Write stub FILE_INDEX.md so older readers don't crash
	const stubPath = path.join(sessionDir, FILE_INDEX_FILENAME) as ValidatedPath;
	const stubContent = buildPaginationStub(pageCount, entries.length);
	AtomicWriter.writeFile(stubPath, stubContent);
}

/**
 * Build the stub FILE_INDEX.md content for paginated repos.
 *
 * @param pageCount - Number of pages
 * @param totalEntries - Total entry count across all pages
 * @returns Markdown string for the stub file
 */
function buildPaginationStub(pageCount: number, totalEntries: number): string {
	const today = new Date().toISOString().slice(0, 10);
	const pageList = Array.from(
		{ length: pageCount },
		(_, i) => `FILE_INDEX_${String(i + 1)}.md`,
	).join(", ");
	return [
		`---`,
		`version: 1`,
		`last_updated: "${today}"`,
		`paginated: true`,
		`pages: ${String(pageCount)}`,
		`---`,
		``,
		`# File Index (Paginated)`,
		``,
		`This project has ${String(totalEntries)} indexed files split across ${String(pageCount)} page${pageCount === 1 ? "" : "s"}.`,
		`Load: ${pageList}`,
		``,
	].join("\n");
}

/**
 * Remove FILE_INDEX_N.md page files, optionally keeping files up to `keepUpTo`.
 *
 * @param sessionDir - Path to .session/
 * @param keepUpTo - Keep pages 1..keepUpTo; pass 0 or omit to remove all
 */
function cleanPageFiles(sessionDir: string, keepUpTo = 0): void {
	let page = keepUpTo + 1;
	while (true) {
		const pagePath = path.join(sessionDir, `FILE_INDEX_${String(page)}.md`);
		if (!fs.existsSync(pagePath)) break;
		try {
			fs.rmSync(pagePath);
		} catch {
			// Best-effort cleanup
		}
		page++;
	}
}

// ---------------------------------------------------------------------------
// Internal: Auditing
// ---------------------------------------------------------------------------

/**
 * Finds entries whose files no longer exist on disk.
 *
 * @param entries - The entries to check.
 * @param projectRoot - The absolute path to the project root directory.
 * @returns Entries whose files are missing from the filesystem.
 */
function findStaleEntries(
	entries: readonly FileIndexEntry[],
	projectRoot: string,
): FileIndexEntry[] {
	return entries.filter((entry) => {
		const absolutePath = path.resolve(projectRoot, entry.filepath);
		return !fs.existsSync(absolutePath);
	});
}

/**
 * Finds chunk IDs that have no corresponding PLAN_N.md file.
 *
 * Chunk ID `0` ("Always Include") is excluded since it has no plan file.
 *
 * @param entries - The entries to extract chunk IDs from.
 * @param sessionDir - The absolute path to the session directory.
 * @returns Chunk IDs with no matching PLAN_N.md file.
 */
function findMissingChunks(entries: readonly FileIndexEntry[], sessionDir: string): number[] {
	const allChunkIds = collectNonZeroChunkIds(entries);
	const missing: number[] = [];

	for (const chunkId of allChunkIds) {
		const planFile = path.join(sessionDir, `PLAN_${String(chunkId)}.md`);
		if (!fs.existsSync(planFile)) {
			missing.push(chunkId);
		}
	}

	return missing.sort((a, b) => a - b);
}

/**
 * Collects all unique non-zero chunk IDs from entries.
 *
 * @param entries - The entries to scan.
 * @returns A sorted array of unique non-zero chunk IDs.
 */
function collectNonZeroChunkIds(entries: readonly FileIndexEntry[]): number[] {
	const ids = new Set<number>();

	for (const entry of entries) {
		for (const tag of entry.chunk_tags) {
			if (tag !== 0) {
				ids.add(tag);
			}
		}
	}

	return [...ids].sort((a, b) => a - b);
}
