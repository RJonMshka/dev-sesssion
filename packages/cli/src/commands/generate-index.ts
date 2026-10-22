/**
 * Migration path C: Auto-generate FILE_INDEX.md from codebase walk.
 *
 * Uses {@link GitignoreAwareWalker} to discover files, groups them by
 * directory, and in interactive mode prompts to tag each group to a chunk.
 * In `--yes` mode, a file is tagged to the chunks whose unfinished tasks or
 * plan-named files name it, and files the plan never names are left out
 * (LLD-first-run.md, LLD-file-index.md).
 *
 * @module
 */

import * as path from "node:path";
import { cancel, isCancel, log, select, spinner } from "@clack/prompts";
import type { FileIndexEntry, PlanChunk, WalkedFile } from "@dev-session/core";
import { FileIndexManager, GitignoreAwareWalker, referencedFiles } from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { CliError } from "@dev-session/security";
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

/** Maximum number of directory groups to display interactively. */
const MAX_INTERACTIVE_GROUPS = 30;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate FILE_INDEX.md from a codebase walk.
 *
 * @param sessionDir - Validated path to the `.session/` directory.
 * @param chunks - The available plan chunks (for tagging options).
 * @param options - CLI options controlling interactivity and writes.
 * @returns The generation result with entries and counts.
 * @throws {CliError} If the user cancels.
 */
export async function generateIndex(
	sessionDir: ValidatedPath,
	chunks: readonly PlanChunk[],
	options: {
		readonly yes: boolean;
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

	if (options.yes) {
		// Tag only what a task names; the ai-index covers the rest (REQ-RUN-1, -4, -6).
		const always = new Set(entries.map((e) => e.filepath));
		const tagged = tagFromTasks(files, chunks, always);
		entries.push(...tagged);
		const left =
			files.length - tagged.length - files.filter((f) => always.has(f.relativePath)).length;
		log.info(
			`Tagged ${String(tagged.length)} file${tagged.length === 1 ? "" : "s"} to chunks from the plan; ${String(left)} left to the ai-index.`,
		);
	} else {
		// Interactive mode: prompt per directory group
		const displayGroups =
			groups.length > MAX_INTERACTIVE_GROUPS ? groups.slice(0, MAX_INTERACTIVE_GROUPS) : groups;

		if (groups.length > MAX_INTERACTIVE_GROUPS) {
			log.warn(
				`Showing first ${MAX_INTERACTIVE_GROUPS} of ${groups.length} directories. Remaining files will be tagged to chunk 1.`,
			);
		}

		for (const group of displayGroups) {
			const totalTokens = group.files.reduce(
				(sum, f) => sum + GitignoreAwareWalker.estimateTokenCost(f),
				0,
			);

			const chunkOptions = [
				{ value: "skip", label: "Skip (don't index)" },
				{ value: "always", label: "Always include" },
				...chunks.map((c) => ({
					value: String(c.chunk_id),
					label: `Chunk ${c.chunk_id}: ${c.title}`,
				})),
			];

			const result = await select({
				message: `${group.directory}/ (${group.files.length} files, ~${totalTokens} tokens)`,
				options: chunkOptions,
			});

			if (isCancel(result)) {
				cancel("Init cancelled.");
				throw new CliError({ message: "Init cancelled by user." });
			}

			if (result === "skip") {
				continue;
			}

			const chunkTag = result === "always" ? 0 : Number.parseInt(result as string, 10);

			for (const file of group.files) {
				const tokenCost = GitignoreAwareWalker.estimateTokenCost(file);
				entries.push({
					filepath: file.relativePath,
					chunk_tags: [chunkTag],
					purpose: inferPurpose(file.relativePath),
					token_cost: tokenCost,
				});
			}
		}

		// Tag remaining groups (if truncated) to chunk 1
		if (groups.length > MAX_INTERACTIVE_GROUPS) {
			const fallbackChunk = chunks[0];
			const activeChunkId = fallbackChunk !== undefined ? fallbackChunk.chunk_id : 1;
			for (const group of groups.slice(MAX_INTERACTIVE_GROUPS)) {
				for (const file of group.files) {
					const tokenCost = GitignoreAwareWalker.estimateTokenCost(file);
					entries.push({
						filepath: file.relativePath,
						chunk_tags: [activeChunkId],
						purpose: inferPurpose(file.relativePath),
						token_cost: tokenCost,
					});
				}
			}
		}
	}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds one entry per walked file the plan names — in an unfinished task, or in
 * an unfinished chunk's `files` — tagged to every chunk that names it
 * (REQ-RUN-1, REQ-IDX-17). Files the plan never names get no entry
 * (REQ-RUN-4): `chunk_tags` must be non-empty, and the ai-index still reaches
 * them.
 *
 * @param files - Walked files.
 * @param chunks - The plan's chunks.
 * @param alwaysInclude - Paths already present as always-include entries.
 * @returns The tagged entries, in walk order.
 */
function tagFromTasks(
	files: readonly WalkedFile[],
	chunks: readonly PlanChunk[],
	alwaysInclude: ReadonlySet<string>,
): FileIndexEntry[] {
	const refs = referencedFiles(
		chunks,
		files.map((f) => f.relativePath),
	);
	const tagged: FileIndexEntry[] = [];
	for (const file of files) {
		const chunkTags = refs.get(file.relativePath);
		if (chunkTags === undefined || alwaysInclude.has(file.relativePath)) continue;
		tagged.push({
			filepath: file.relativePath,
			chunk_tags: chunkTags,
			purpose: inferPurpose(file.relativePath),
			token_cost: GitignoreAwareWalker.estimateTokenCost(file),
		});
	}
	return tagged;
}

/**
 * Infer a short purpose description from a file path.
 *
 * @param filepath - The relative file path.
 * @returns A short purpose string.
 */
function inferPurpose(filepath: string): string {
	const base = path.basename(filepath);
	const ext = path.extname(filepath);
	const dir = path.dirname(filepath);

	if (base === "package.json") return "Package manifest";
	if (base === "tsconfig.json") return "TypeScript config";
	if (base === "tsconfig.build.json") return "Build-only TypeScript config";
	if (base === "tsup.config.ts") return "Build config";
	if (base === "vitest.config.ts") return "Test config";
	if (base === "biome.json") return "Linter/formatter config";
	if (base === ".npmrc") return "npm/pnpm settings";
	if (base === ".nvmrc") return "Node version";
	if (base === ".gitignore") return "Git ignore rules";
	if (base === "README.md") return "Documentation";
	if (base === "CHANGELOG.md") return "Change log";
	if (base === "LICENSE") return "License file";

	if (base.endsWith(".test.ts") || base.endsWith(".spec.ts")) {
		return `Tests for ${base.replace(/\.(test|spec)\.ts$/, "")}`;
	}

	if (ext === ".ts" || ext === ".tsx") {
		if (base === "index.ts" || base === "index.tsx") {
			return `${dir === "." ? "Root" : dir} entry point`;
		}
		return `${base.replace(ext, "")} module`;
	}

	if (ext === ".md") return "Documentation";
	if (ext === ".json") return "Configuration";
	if (ext === ".yml" || ext === ".yaml") return "Configuration";

	return "Project file";
}
