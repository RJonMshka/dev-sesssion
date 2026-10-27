/**
 * Migration path C: Auto-generate FILE_INDEX.md from codebase walk.
 *
 * Uses {@link GitignoreAwareWalker} to discover files. A file is tagged to
 * the chunks whose unfinished tasks or plan-named files name it, and files the
 * plan never names are left out (LLD-first-run.md, LLD-file-index.md). Both
 * modes tag the same way and ask no question: a per-directory prompt tagged
 * files by where they sat, which is not evidence (LLD-tagging.md,
 * REQ-IDX-42, -43). `index add` tags a single file by hand.
 *
 * @module
 */

import * as path from "node:path";
import { log, spinner } from "@clack/prompts";
import type { FileIndexEntry, PlanChunk } from "@dev-session/core";
import { FileIndexManager, GitignoreAwareWalker, PlanTags } from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { dryRunWrite } from "../utils/dry-run.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result from FILE_INDEX generation. */
export interface GenerateIndexResult {
	/** The generated file index entries. */
	readonly entries: readonly FileIndexEntry[];
	/** Number of files indexed. */
	readonly fileCount: number;
	/** Number of always-include files. */
	readonly alwaysIncludeCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files that are always included in context regardless of chunk. */
const DEFAULT_ALWAYS_INCLUDE: ReadonlyArray<{
	readonly filepath: string;
	readonly purpose: string;
}> = [
	{ filepath: "CLAUDE.md", purpose: "AI session instructions" },
	{ filepath: "AGENTS.md", purpose: "AI agent instructions" },
	{ filepath: ".session/SESSION_STATE.md", purpose: "Active chunk + task tracking" },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate FILE_INDEX.md from a codebase walk.
 *
 * @param sessionDir - Validated path to the `.session/` directory.
 * @param chunks - The available plan chunks (for tagging options).
 * @param options - CLI options controlling writes.
 * @returns The generation result with entries and counts.
 */
export async function generateIndex(
	sessionDir: ValidatedPath,
	chunks: readonly PlanChunk[],
	options: {
		readonly dryRun: boolean;
		readonly verbose: boolean;
		readonly cwd: string;
		/** Cap the total number of indexed files. Defaults to unlimited. */
		readonly maxFiles?: number;
	},
): Promise<GenerateIndexResult> {
	const s = spinner();

	// --- Walk codebase ---
	s.start("Scanning codebase...");
	let files = GitignoreAwareWalker.walk(options.cwd);
	if (options.maxFiles !== undefined && files.length > options.maxFiles) {
		log.warn(
			`Found ${String(files.length)} files — capping at ${String(options.maxFiles)} (--max-files). Remaining files will not be indexed.`,
		);
		files = files.slice(0, options.maxFiles);
	}
	const groups = GitignoreAwareWalker.groupByDirectory(files);
	s.stop(
		`Found ${files.length} file${files.length === 1 ? "" : "s"} across ${groups.length} director${groups.length === 1 ? "y" : "ies"}.`,
	);

	// --- Build entries ---
	const entries: FileIndexEntry[] = [];

	// Add default always-include entries that exist on disk
	let alwaysIncludeCount = 0;
	for (const ai of DEFAULT_ALWAYS_INCLUDE) {
		const fullPath = path.join(options.cwd, ai.filepath);
		try {
			const { statSync } = await import("node:fs");
			if (statSync(fullPath).isFile()) {
				entries.push({
					filepath: ai.filepath,
					chunk_tags: [0],
					purpose: ai.purpose,
				});
				alwaysIncludeCount++;
			}
		} catch {
			// File doesn't exist — skip
		}
	}

	// Tag only what the plan names; the ai-index covers the rest (REQ-RUN-1, -4,
	// -6; REQ-IDX-42).
	const always = new Set(entries.map((e) => e.filepath));
	const tagged = PlanTags.fromPlan(files, chunks, always);
	entries.push(...tagged);
	const left =
		files.length - tagged.length - files.filter((f) => always.has(f.relativePath)).length;
	log.info(
		`Tagged ${String(tagged.length)} file${tagged.length === 1 ? "" : "s"} to chunks from the plan; ${String(left)} left to the ai-index.`,
	);

	// --- Write FILE_INDEX.md ---
	if (options.dryRun) {
		const preview = `FILE_INDEX.md (${entries.length} entries)`;
		const fullPath = path.join(sessionDir, "FILE_INDEX.md");
		dryRunWrite(fullPath, preview, options.cwd);
	} else {
		FileIndexManager.save(sessionDir, entries);
	}

	const indexedCount = entries.filter((e) => !e.chunk_tags.includes(0)).length;
	if (!options.dryRun) {
		log.success(
			`Indexed ${indexedCount} file${indexedCount === 1 ? "" : "s"}. Always-include: ${alwaysIncludeCount} file${alwaysIncludeCount === 1 ? "" : "s"}.`,
		);
	}

	return {
		entries,
		fileCount: indexedCount,
		alwaysIncludeCount,
	};
}
