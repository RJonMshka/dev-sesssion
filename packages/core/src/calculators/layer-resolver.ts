/**
 * Resolves the effective context layer for each file in a session's bootstrap.
 *
 * The Chunk 12 ai-index can render each file at three layers (0 = module
 * summary + symbol names, 1 = signatures, 2 = full source). This module decides
 * *which* layer each file should load at, given its role and the active tasks:
 *
 * 1. Base layer by role — chunk-tagged files default to layer 0, always-include
 *    files to layer 1.
 * 2. An author's `@ai-layer-default` (surfaced as {@link FileEntry.layer_default})
 *    raises the floor, never lowers it.
 * 3. Escalation — a file referenced by an active (non-done) task loads at layer 2.
 *
 * The result drives both the layered budget calculation and the `preview`
 * per-file layer / escalation-delta display.
 *
 * @packageDocumentation
 */

import { AiIndexManager } from "../annotation/ai-index-manager.js";
import type { AiIndex, FileEntry } from "../annotation/types.js";
import type { FileIndexEntry, Task } from "../schemas/index.js";
import { ContextBudgetCalculator } from "./context-budget-calculator.js";

/** The role a file plays in the bootstrap, which sets its base layer. */
export type FileLayerRole = "chunk" | "always-include";

/** A single file's resolved layer decision. */
export interface ResolvedFileLayer {
	/** Relative file path from the project root. */
	readonly filepath: string;
	/** Whether the file is chunk-tagged or always-include. */
	readonly role: FileLayerRole;
	/** The layer implied by role + `@ai-layer-default`, before escalation. */
	readonly baseLayer: 0 | 1 | 2;
	/** The effective layer the file should load at. */
	readonly layer: 0 | 1 | 2;
	/** Whether an active task escalated this file to layer 2. */
	readonly escalated: boolean;
	/** The text of the task that triggered escalation, if any. */
	readonly escalatedBy?: string;
	/** Estimated token cost of loading the whole file (layer 2). */
	readonly fullTokenCost: number;
	/** Estimated token cost of loading the file at its effective layer. */
	readonly layeredTokenCost: number;
}

/** Inputs for {@link LayerResolver.resolve}. */
export interface LayerResolverInput {
	/** File index entries tagged to the active chunk. */
	readonly chunkFiles: readonly FileIndexEntry[];
	/** File index entries tagged as always-include. */
	readonly alwaysIncludeFiles: readonly FileIndexEntry[];
	/** The active chunk's tasks (used to detect escalation). */
	readonly tasks: readonly Task[];
	/** The loaded ai-index, or `null` if none has been generated. */
	readonly index: AiIndex | null;
}

/** Base layer for each role, before any annotation floor or escalation. */
const ROLE_BASE_LAYER: Readonly<Record<FileLayerRole, 0 | 1 | 2>> = {
	chunk: 0,
	"always-include": 1,
};

/** Fallback layered cost when a file has no ai-index entry to render from. */
const DEFAULT_FILE_TOKEN_COST = 50;

/**
 * Returns the higher of two layers.
 *
 * @param a - First layer.
 * @param b - Second layer.
 * @returns The greater layer value.
 */
function maxLayer(a: 0 | 1 | 2, b: 0 | 1 | 2): 0 | 1 | 2 {
	return (a > b ? a : b) as 0 | 1 | 2;
}

/**
 * Determines whether a task's text references a file by path or basename.
 *
 * A reference is a plain substring match on either the full relative path or
 * the file's basename (e.g. `"session-manager.ts"`), which is how authors
 * naturally name files in task descriptions.
 *
 * @param taskText - The task description.
 * @param filepath - The relative file path to look for.
 * @returns `true` if the task text mentions the file.
 */
function taskReferencesFile(taskText: string, filepath: string): boolean {
	if (taskText.includes(filepath)) {
		return true;
	}
	const basename = filepath.split("/").pop();
	return basename !== undefined && basename.length > 0 && taskText.includes(basename);
}

/**
 * Finds the first active (non-done) task that references the given file.
 *
 * @param filepath - The relative file path.
 * @param tasks - The chunk's tasks.
 * @returns The referencing task's text, or `undefined` if none.
 */
function findEscalatingTask(filepath: string, tasks: readonly Task[]): string | undefined {
	for (const task of tasks) {
		if (task.status === "done") {
			continue;
		}
		if (taskReferencesFile(task.text, filepath)) {
			return task.text;
		}
	}
	return undefined;
}

/**
 * Estimates the token cost of rendering a file entry at the given layer.
 *
 * Layer 2 returns the entry's full token cost; layers 0 and 1 are estimated
 * from the rendered text via the heuristic counter.
 *
 * @param relPath - Relative file path (used as the render header).
 * @param entry - The ai-index entry for the file.
 * @param layer - The layer to estimate.
 * @returns The estimated token cost at that layer.
 */
function estimateLayeredCost(relPath: string, entry: FileEntry, layer: 0 | 1 | 2): number {
	if (layer === 2) {
		return entry.token_cost;
	}
	const rendered =
		layer === 0
			? AiIndexManager.renderLayer0(relPath, entry)
			: AiIndexManager.renderLayer1(relPath, entry);
	return ContextBudgetCalculator.estimateFromString(rendered);
}

/**
 * Resolves the effective context layer for every bootstrap file.
 */
export const LayerResolver = {
	/**
	 * Resolve per-file layers for the given chunk and always-include files.
	 *
	 * Always-include files are resolved first, then chunk files; a file that
	 * appears in both lists is only resolved once (as always-include).
	 *
	 * @param input - The chunk files, always-include files, tasks, and ai-index.
	 * @returns One {@link ResolvedFileLayer} per distinct file.
	 */
	resolve(input: LayerResolverInput): readonly ResolvedFileLayer[] {
		const { chunkFiles, alwaysIncludeFiles, tasks, index } = input;
		const seen = new Set<string>();
		const resolved: ResolvedFileLayer[] = [];

		const resolveOne = (entry: FileIndexEntry, role: FileLayerRole): void => {
			if (seen.has(entry.filepath)) {
				return;
			}
			seen.add(entry.filepath);

			const indexEntry = index?.files[entry.filepath];
			const roleBase = ROLE_BASE_LAYER[role];
			const baseLayer = indexEntry ? maxLayer(roleBase, indexEntry.layer_default) : roleBase;

			const escalatedBy = findEscalatingTask(entry.filepath, tasks);
			const escalated = escalatedBy !== undefined;
			const layer = escalated ? 2 : baseLayer;

			const fullTokenCost = indexEntry?.token_cost ?? entry.token_cost ?? DEFAULT_FILE_TOKEN_COST;
			const layeredTokenCost = indexEntry
				? estimateLayeredCost(entry.filepath, indexEntry, layer)
				: fullTokenCost;

			resolved.push({
				filepath: entry.filepath,
				role,
				baseLayer,
				layer,
				escalated,
				...(escalatedBy !== undefined ? { escalatedBy } : {}),
				fullTokenCost,
				layeredTokenCost,
			});
		};

		for (const entry of alwaysIncludeFiles) {
			resolveOne(entry, "always-include");
		}
		for (const entry of chunkFiles) {
			resolveOne(entry, "chunk");
		}

		return resolved;
	},
} as const;
