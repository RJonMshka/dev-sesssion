/**
 * Static analysis linter for session context files.
 *
 * Provides three analysis passes — all local, no API key required:
 * 1. `detectDuplicates` — cross-file duplicate block detection
 * 2. `detectSoftLanguage` — hedging/vague language that wastes tokens
 * 3. `detectDeadReferences` — `@mention` file paths that do not exist on disk
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single lint finding from a context analysis pass.
 */
export interface LintResult {
	/** How severe the finding is. */
	readonly severity: "error" | "warning" | "info";
	/** Machine-readable rule identifier. */
	readonly rule: string;
	/** File the finding was found in. */
	readonly file: string;
	/** Line number (1-based), if known. */
	readonly line?: number;
	/** Human-readable description of the finding. */
	readonly message: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a line for duplicate comparison.
 *
 * @param line - Raw line string.
 * @returns Trimmed, lowercased line.
 */
function normalizeLine(line: string): string {
	return line.trim().toLowerCase();
}

/**
 * Extracts overlapping n-grams (blocks of `size` consecutive lines) from content.
 *
 * @param lines - Array of normalized lines.
 * @param size - Block size in lines.
 * @returns Array of block strings (joined with newline).
 */
function extractBlocks(lines: readonly string[], size: number): string[] {
	const blocks: string[] = [];
	for (let i = 0; i <= lines.length - size; i++) {
		blocks.push(lines.slice(i, i + size).join("\n"));
	}
	return blocks;
}

/**
 * Soft language patterns that indicate vague or hedging content.
 * Each entry is [pattern, suggestion].
 */
const SOFT_LANGUAGE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bmaybe\b/gi, 'Replace "maybe" with a definitive statement or remove'],
	[/\bpossibly\b/gi, 'Replace "possibly" with a definitive statement or remove'],
	[/\bperhaps\b/gi, 'Replace "perhaps" with a definitive statement or remove'],
	[/\byou (?:might|could|should) (?:want to|try to|consider)\b/gi, "Use imperative form instead"],
	[/\bconsider (?:using|adding|trying)\b/gi, "Use imperative form instead"],
	[/\bmight be (?:a good idea|worth)\b/gi, "Use imperative form instead"],
	[/\bif (?:you want|needed)\b/gi, "Use definitive requirement language"],
	[/\boptionally\b/gi, 'Replace "optionally" with explicit conditionality'],
];

/**
 * Regex to find `@`-mention file references in content.
 *
 * Matches patterns like `@src/index.ts`, `@packages/core/src/index.ts`.
 */
const AT_MENTION_RE = /@([\w./-]+\.\w+)/g;

// ---------------------------------------------------------------------------
// ContextLinter
// ---------------------------------------------------------------------------

/**
 * Static analysis linter for dev-session context files.
 *
 * All methods are pure/side-effect-free except `detectDeadReferences`
 * which reads the filesystem to check path existence.
 */
export const ContextLinter = {
	/**
	 * Detects duplicate content blocks across multiple files.
	 *
	 * Normalizes each file's content, extracts overlapping 3-line blocks,
	 * and flags any block that appears in more than one file. Reports a
	 * `warning` for each pair of files sharing duplicate content.
	 *
	 * @param files - Map of filepath → file content strings to analyze.
	 * @returns Array of {@link LintResult} warnings for duplicate blocks found.
	 */
	detectDuplicates(files: Readonly<Record<string, string>>): LintResult[] {
		const BLOCK_SIZE = 3;
		const MIN_BLOCK_LENGTH = 30; // skip very short blocks (e.g., blank lines)

		// Build a map: normalized_block → [filepath, ...]
		const blockToFiles = new Map<string, string[]>();

		for (const [filepath, content] of Object.entries(files)) {
			const rawLines = content.split("\n");
			const normalized = rawLines.map(normalizeLine).filter((l) => l.length > 0);
			const blocks = extractBlocks(normalized, BLOCK_SIZE);

			for (const block of blocks) {
				if (block.length < MIN_BLOCK_LENGTH) {
					continue;
				}
				const existing = blockToFiles.get(block);
				if (existing === undefined) {
					blockToFiles.set(block, [filepath]);
				} else if (!existing.includes(filepath)) {
					existing.push(filepath);
				}
			}
		}

		const results: LintResult[] = [];
		const reported = new Set<string>(); // avoid duplicate reports for same pair

		for (const [block, filePaths] of blockToFiles.entries()) {
			if (filePaths.length < 2) {
				continue;
			}

			for (let i = 0; i < filePaths.length - 1; i++) {
				for (let j = i + 1; j < filePaths.length; j++) {
					const fileA = filePaths[i] as string;
					const fileB = filePaths[j] as string;
					const pairKey = `${fileA}|${fileB}|${block.slice(0, 40)}`;
					if (reported.has(pairKey)) {
						continue;
					}
					reported.add(pairKey);

					const preview = block.split("\n")[0] ?? "";
					results.push({
						severity: "warning",
						rule: "no-duplicate-blocks",
						file: fileA,
						message: `Duplicate content block also found in "${fileB}": "${preview.slice(0, 60)}${preview.length > 60 ? "…" : ""}"`,
					});
				}
			}
		}

		return results;
	},

	/**
	 * Detects soft/hedging language in a single file's content.
	 *
	 * Reports an `info` finding per matched line for each soft language pattern.
	 * Soft language wastes tokens and reduces instruction clarity.
	 *
	 * @param filepath - The path to the file (used in LintResult.file).
	 * @param content - The file content to analyze.
	 * @returns Array of {@link LintResult} info findings per match.
	 */
	detectSoftLanguage(filepath: string, content: string): LintResult[] {
		const lines = content.split("\n");
		const results: LintResult[] = [];

		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const line = lines[lineIdx] ?? "";
			for (const [pattern, suggestion] of SOFT_LANGUAGE_PATTERNS) {
				// Reset lastIndex for global regexes
				pattern.lastIndex = 0;
				const match = pattern.exec(line);
				if (match !== null) {
					results.push({
						severity: "info",
						rule: "no-soft-language",
						file: filepath,
						line: lineIdx + 1,
						message: `Soft language "${match[0]}": ${suggestion}`,
					});
					// Only report one soft-language finding per line to avoid noise
					break;
				}
			}
		}

		return results;
	},

	/**
	 * Detects dead `@mention` references in a file's content.
	 *
	 * Scans for `@path/to/file.ext` patterns and checks whether each
	 * referenced path exists on disk relative to the project root.
	 * Reports an `error` for every non-existent path.
	 *
	 * @param filepath - The path to the file being analyzed (used in LintResult.file).
	 * @param content - The file content to analyze.
	 * @param projectRoot - Absolute path to the project root directory.
	 * @returns Array of {@link LintResult} errors for dead references found.
	 */
	detectDeadReferences(filepath: string, content: string, projectRoot: string): LintResult[] {
		const lines = content.split("\n");
		const results: LintResult[] = [];

		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const line = lines[lineIdx] ?? "";
			// Reset lastIndex
			AT_MENTION_RE.lastIndex = 0;

			for (;;) {
				const match = AT_MENTION_RE.exec(line);
				if (match === null) {
					break;
				}
				const mentionedPath = match[1];
				if (mentionedPath === undefined) {
					continue;
				}
				const absolutePath = path.resolve(projectRoot, mentionedPath);

				if (!fs.existsSync(absolutePath)) {
					results.push({
						severity: "error",
						rule: "no-dead-references",
						file: filepath,
						line: lineIdx + 1,
						message: `Dead @mention reference: "${mentionedPath}" does not exist`,
					});
				}
			}
		}

		return results;
	},
} as const;
