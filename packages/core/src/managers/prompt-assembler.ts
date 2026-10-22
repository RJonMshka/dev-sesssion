/**
 * PromptAssembler — turns session state into `NEXT_PROMPT.md` content and its
 * context manifest.
 *
 * `init`, `update`, `advance`, `index` and `import` all regenerate the prompt
 * through this one function, so the same `.session/` always yields the same
 * prompt whichever command wrote it (LLD-first-run.md, REQ-RUN-16). Before it
 * existed, the assembly was a block copied into three commands.
 *
 * It is pure: it reads and writes nothing. Callers load the inputs, and persist
 * the result with `NextPromptWriter.write` and `ContextManifest.write`.
 *
 * @packageDocumentation
 */

import type { AiIndex } from "../annotation/types.js";
import { ContextBudgetCalculator } from "../calculators/context-budget-calculator.js";
import { type ContextPlan, LayerResolver } from "../calculators/layer-resolver.js";
import type { BootstrapContext, BootstrapFormatter } from "../formatters/bootstrap-formatter.js";
import type {
	ContextBudget,
	ContextManifestData,
	FileIndexEntry,
	PlanChunk,
	SessionState,
} from "../schemas/index.js";
import { ContextManifest } from "./context-manifest.js";
import { FileIndexManager } from "./file-index-manager.js";
import { NextPromptWriter } from "./next-prompt-writer.js";

/** Everything a prompt is built from. */
export interface AssembleInput {
	/** The session state, as persisted. */
	readonly state: SessionState;
	/** The active chunk. */
	readonly chunk: PlanChunk;
	/** Every chunk in the plan. */
	readonly allChunks: readonly PlanChunk[];
	/** Every `FILE_INDEX.md` entry. */
	readonly entries: readonly FileIndexEntry[];
	/** The ai-index, or `null` when there is none. */
	readonly index: AiIndex | null;
	/** The adapter's formatter. */
	readonly formatter: BootstrapFormatter;
	/** Project name shown in the prompt. */
	readonly projectName: string;
	/**
	 * The adapter's state transform, already bound to its context. Applied to
	 * the state the prompt renders, not to the state the budget is charged for.
	 */
	readonly transformState?: (state: SessionState) => SessionState;
	/**
	 * Paths `trim` excluded (`trim-overrides.json`). They are left out of the
	 * load lines, focus, budget and manifest, and added to the exclude patterns
	 * (REQ-RUN-20).
	 */
	readonly excluded?: readonly string[];
}

/** What charging the budget needs: the session, without any formatting. */
export type ChargeInput = Pick<AssembleInput, "state" | "chunk" | "entries" | "index" | "excluded">;

/** The context a prompt would load, and the budget it is charged. */
export interface ChargedContext {
	/** The context budget. */
	readonly budget: ContextBudget;
	/** The resolved layers and focus. */
	readonly plan: ContextPlan;
	/** Files tagged to the active chunk, trimmed paths removed. */
	readonly chunkFiles: readonly FileIndexEntry[];
	/** Always-include files. */
	readonly alwaysIncludeFiles: readonly FileIndexEntry[];
}

/** The assembled prompt and what it was built from. */
export interface AssembledPrompt {
	/** `NEXT_PROMPT.md` content. */
	readonly prompt: string;
	/** The context manifest for that prompt. */
	readonly manifest: ContextManifestData;
	/** The context budget the prompt was charged. */
	readonly budget: ContextBudget;
	/** Files tagged to the active chunk. */
	readonly chunkFiles: readonly FileIndexEntry[];
	/** Always-include files. */
	readonly alwaysIncludeFiles: readonly FileIndexEntry[];
	/** The resolved layers and focus the prompt was built from. */
	readonly plan: ContextPlan;
}

/** Paths every prompt tells the agent not to load. */
const BASE_EXCLUDES = ["**/__tests__/**", "**/dist/**", "**/node_modules/**"] as const;

/**
 * Charges the context budget: layered when an ai-index exists, by whole-file
 * cost otherwise.
 *
 * @param input - The assembly input.
 * @param plan - The resolved context plan.
 * @param chunkFiles - Files tagged to the active chunk.
 * @param alwaysIncludeFiles - Always-include files.
 * @returns The budget.
 */
function chargeBudget(
	input: ChargeInput,
	plan: ContextPlan,
	chunkFiles: readonly FileIndexEntry[],
	alwaysIncludeFiles: readonly FileIndexEntry[],
): ContextBudget {
	const { state, chunk, index } = input;
	return index !== null
		? ContextBudgetCalculator.estimateLayered(state, chunk, plan.layers, undefined, plan.focus)
		: ContextBudgetCalculator.estimate(state, chunk, chunkFiles, alwaysIncludeFiles);
}

/**
 * Drops focused units that live in a trimmed file. The resolver focuses units
 * anywhere in the index, so trimming a chunk file alone would not keep it out
 * (REQ-RUN-20).
 *
 * @param plan - The resolved context plan.
 * @param excluded - Trimmed paths.
 * @returns The plan without units in trimmed files.
 */
function withoutExcluded(plan: ContextPlan, excluded: ReadonlySet<string>): ContextPlan {
	if (excluded.size === 0) return plan;
	return { ...plan, focus: plan.focus.filter((u) => !excluded.has(u.filepath)) };
}

/**
 * Assembles prompts. All methods are static.
 */
export const PromptAssembler = {
	/**
	 * Resolves what the prompt would load and charges its budget, without
	 * formatting anything. `assemble` is built on it, and `health` judges the
	 * budget by it, so the two cannot disagree (LLD-budget.md, REQ-BUD-5).
	 *
	 * @param input - The session: state, active chunk, entries, ai-index, trims.
	 * @returns The plan, the budget, and the files it was charged for.
	 */
	charge(input: ChargeInput): ChargedContext {
		const { chunk, entries, index } = input;
		const excluded = new Set(input.excluded ?? []);
		const chunkFiles = FileIndexManager.queryByChunk(entries, chunk.chunk_id).filter(
			(e) => !excluded.has(e.filepath),
		);
		const alwaysIncludeFiles = FileIndexManager.alwaysInclude(entries);
		const plan = withoutExcluded(
			LayerResolver.plan({ chunkFiles, alwaysIncludeFiles, tasks: chunk.tasks, index }),
			excluded,
		);
		const budget = chargeBudget(input, plan, chunkFiles, alwaysIncludeFiles);
		return { budget, plan, chunkFiles, alwaysIncludeFiles };
	},

	/**
	 * Builds the prompt, its manifest and its budget from session state.
	 *
	 * @param input - The loaded session and the adapter's formatter.
	 * @returns The assembled prompt.
	 */
	assemble(input: AssembleInput): AssembledPrompt {
		const { state, chunk, index } = input;
		const excluded = new Set(input.excluded ?? []);
		const { plan, budget, chunkFiles, alwaysIncludeFiles } = PromptAssembler.charge(input);
		const shown = input.transformState ? input.transformState(state) : state;

		const context: BootstrapContext = {
			state: shown,
			chunk,
			chunkFiles,
			alwaysIncludeFiles,
			budget,
			excludePatterns: [
				...PromptAssembler.excludePatterns(chunk.chunk_id, input.allChunks),
				...excluded,
			],
			projectName: input.projectName,
			maxPromptLines: shown.max_prompt_lines,
			...(index !== null ? { resolvedLayers: plan.layers, focusUnits: plan.focus } : {}),
		};
		const prompt = NextPromptWriter.generateWithFormatter(input.formatter, context);
		const manifest = ContextManifest.build({ plan, index, prompt, activeChunk: chunk.chunk_id });
		return { prompt, manifest, budget, chunkFiles, alwaysIncludeFiles, plan };
	},

	/**
	 * Paths the prompt excludes: tests, build output, dependencies, and every
	 * other chunk's plan file.
	 *
	 * @param activeChunk - The active chunk id.
	 * @param allChunks - Every chunk in the plan.
	 * @returns The exclude patterns.
	 */
	excludePatterns(activeChunk: number, allChunks: readonly PlanChunk[]): string[] {
		const patterns: string[] = [...BASE_EXCLUDES];
		for (const chunk of allChunks) {
			if (chunk.chunk_id !== activeChunk) {
				patterns.push(`.session/PLAN_${String(chunk.chunk_id)}.md`);
			}
		}
		return patterns;
	},
} as const;
