/**
 * `dev-sesssion preview` command.
 *
 * Assembles the full bootstrap context exactly as the active adapter's
 * formatter would produce it, and displays a token breakdown table so
 * users can see exactly what the model will receive.
 *
 * Options:
 * - `--format json` — machine-readable breakdown for scripting / CI
 * - `--copy` — copies assembled prompt to clipboard
 * - `--no-content` — show breakdown only, suppress full prompt text
 *
 * No API key required — all token counts use the heuristic fallback.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "@clack/prompts";
import {
	AiIndexManager,
	type BootstrapContext,
	ContextBudgetCalculator,
	DEFAULT_CONTEXT_BUDGET,
	FileIndexManager,
	LayerResolver,
	NextPromptWriter,
	PlanChunkManager,
	type ResolvedFileLayer,
	SessionStateManager,
	TokenCounter,
	TrimOverridesManager,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { createAdapterReadFile } from "../utils/adapter-io.js";
import { handleError } from "../utils/error-handler.js";
import { resolveAdapter } from "../utils/resolve-adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from Commander to the preview action. */
export interface PreviewOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Output format. */
	readonly format: "text" | "json";
	/** Copy assembled prompt to clipboard. */
	readonly copy: boolean;
	/** Suppress full prompt text; show breakdown only. */
	readonly noContent: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Explicit adapter override. */
	readonly adapter?: string;
}

/** Per-file token info, including its resolved context layer. */
export interface FileTokenInfo {
	readonly path: string;
	/** Effective token cost at the file's resolved layer. */
	readonly tokens: number;
	/** Whole-file token cost (what loading the full source would add). */
	readonly fullTokens: number;
	/** Resolved layer (0/1/2), or `null` when no ai-index is available. */
	readonly layer: 0 | 1 | 2 | null;
	/** Whether an active task escalated this file to full source. */
	readonly escalated: boolean;
}

/** Per-component token info. */
export interface TokenBreakdownEntry {
	readonly label: string;
	readonly tokens: number;
	readonly percent: number;
	readonly files?: readonly FileTokenInfo[];
}

/** Full JSON output for --format json. */
export interface PreviewJson {
	readonly total_tokens: number;
	readonly budget_cap: number;
	readonly over_budget: boolean;
	readonly accurate: boolean;
	readonly components: {
		readonly session_state: { tokens: number; file: string };
		readonly plan_chunk: { tokens: number; file: string };
		readonly always_include: {
			tokens: number;
			files: readonly FileTokenInfo[];
		};
		readonly context_files: {
			tokens: number;
			files: readonly FileTokenInfo[];
		};
		readonly excluded_files: readonly string[];
	};
	/** Tokens saved by layered loading vs. loading every file in full. */
	readonly layered_savings: number;
	readonly prompt_text: string;
	readonly heuristic_warning: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect project name from package.json.
 *
 * @param cwd - Working directory
 * @returns Project name or directory basename
 */
function detectProjectName(cwd: string): string {
	try {
		const pkgPath = path.join(cwd, "package.json");
		const raw = fs.readFileSync(pkgPath, "utf-8");
		const pkg: unknown = JSON.parse(raw);
		if (
			typeof pkg === "object" &&
			pkg !== null &&
			"name" in pkg &&
			typeof (pkg as Record<string, unknown>).name === "string"
		) {
			return (pkg as Record<string, unknown>).name as string;
		}
	} catch {
		// No package.json or invalid JSON
	}
	return path.basename(cwd);
}

/**
 * Reads a file's content for token counting.
 *
 * @param filePath - Absolute path to read.
 * @returns Content string, or empty string if unreadable.
 */
function safeReadFile(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

/**
 * Renders the token breakdown as a human-readable table.
 *
 * @param breakdown - Array of breakdown entries.
 * @param totalTokens - Grand total tokens.
 * @param budgetCap - Budget cap.
 * @param overBudget - Whether total exceeds cap.
 * @param accurate - Whether counts are accurate (vs heuristic).
 * @returns Multi-line table string.
 */
export function renderBreakdownTable(
	breakdown: readonly TokenBreakdownEntry[],
	totalTokens: number,
	budgetCap: number,
	overBudget: boolean,
	accurate: boolean,
): string {
	const LABEL_WIDTH = 38;
	const TOKEN_WIDTH = 8;
	const PCT_WIDTH = 6;
	const SEP = "─".repeat(LABEL_WIDTH + TOKEN_WIDTH + PCT_WIDTH + 4);
	const prefix = accurate ? "" : "~";
	const status = overBudget ? "OVER BUDGET" : "OK";

	const lines: string[] = [];
	lines.push(
		`${"Component".padEnd(LABEL_WIDTH)} ${"Tokens".padStart(TOKEN_WIDTH)} ${"".padStart(PCT_WIDTH)}`,
	);
	lines.push(SEP);

	for (const entry of breakdown) {
		const pct = totalTokens > 0 ? `${String(entry.percent)}%` : "—";
		lines.push(
			`${entry.label.padEnd(LABEL_WIDTH)} ${(prefix + String(entry.tokens)).padStart(TOKEN_WIDTH)} ${pct.padStart(PCT_WIDTH)}`,
		);
		if (entry.files !== undefined) {
			for (const f of entry.files) {
				const filePct =
					totalTokens > 0 ? `${String(Math.round((f.tokens / totalTokens) * 100))}%` : "—";
				// Layer marker: "L0"/"L1"/"L2", with "*" when escalated by a task.
				const layerMark = f.layer === null ? "  " : `L${String(f.layer)}${f.escalated ? "*" : " "}`;
				// Escalation delta: extra tokens a full (layer-2) load would add.
				const delta = f.fullTokens - f.tokens;
				const deltaStr = delta > 0 ? ` (+${String(delta)} full)` : "";
				const pathWidth = LABEL_WIDTH - 5;
				const shortPath = f.path.length > pathWidth ? `…${f.path.slice(-(pathWidth - 1))}` : f.path;
				lines.push(
					`  ${layerMark} ${shortPath.padEnd(pathWidth)} ${(prefix + String(f.tokens)).padStart(TOKEN_WIDTH)} ${filePct.padStart(PCT_WIDTH)}${deltaStr}`,
				);
			}
		}
	}

	lines.push(SEP);
	lines.push(
		`${"TOTAL".padEnd(LABEL_WIDTH)} ${(prefix + String(totalTokens)).padStart(TOKEN_WIDTH)}   / ${String(budgetCap)} [${status}]`,
	);

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Executes the preview command.
 *
 * @param options - Resolved CLI options.
 */
export async function runPreview(options: PreviewOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);

	const state = SessionStateManager.load(sessionDir);
	const chunk = PlanChunkManager.loadActive(sessionDir, state);
	const allEntries = FileIndexManager.load(sessionDir);
	const alwaysInclude = FileIndexManager.alwaysInclude(allEntries);
	let chunkFiles = FileIndexManager.queryByChunk(allEntries, state.active_chunk);

	const trimOverrides = TrimOverridesManager.load(sessionDir);
	const excludedPaths = TrimOverridesManager.getExcludedPaths(trimOverrides);
	if (excludedPaths.length > 0) {
		chunkFiles = chunkFiles.filter(
			(f) => !TrimOverridesManager.isExcluded(trimOverrides, f.filepath),
		);
	}

	const allChunks = PlanChunkManager.loadAll(sessionDir);
	const excludePatterns = [
		"**/__tests__/**",
		"**/dist/**",
		"**/node_modules/**",
		...allChunks
			.filter((c) => c.chunk_id !== state.active_chunk)
			.map((c) => `.session/PLAN_${String(c.chunk_id)}.md`),
		...excludedPaths,
	];

	// Count tokens per component
	const counter = TokenCounter.create();
	const sessionStatePath = path.join(sessionDir, "SESSION_STATE.md");
	const planChunkPath = path.join(sessionDir, `PLAN_${String(state.active_chunk)}.md`);

	const sessionStateContent = safeReadFile(sessionStatePath);
	const planChunkContent = safeReadFile(planChunkPath);

	const sessionStateTokens = (await counter.countString(sessionStateContent)).tokens;
	const planChunkTokens = (await counter.countString(planChunkContent)).tokens;

	// Resolve the effective layer for every bootstrap file. Files default to
	// layer 0 (chunk) / layer 1 (always-include) and escalate to full source
	// (layer 2) when an active task references them. Layered costs require an
	// ai-index; without one every file is charged at its whole-file cost.
	const aiIndex = AiIndexManager.load(sessionDir);
	const resolved = LayerResolver.resolve({
		chunkFiles,
		alwaysIncludeFiles: alwaysInclude,
		tasks: chunk.tasks,
		index: aiIndex,
	});

	// Read each file once to derive its whole-file ("full") cost, then charge
	// the effective layered cost from the resolver.
	const allCosts = await Promise.all(
		resolved.map(async (r): Promise<FileTokenInfo & { role: ResolvedFileLayer["role"] }> => {
			const content = safeReadFile(path.join(options.cwd, r.filepath));
			const fullTokens = (await counter.countString(content)).tokens;
			const hasLayer = aiIndex !== null;
			const tokens = !hasLayer || r.layer === 2 ? fullTokens : r.layeredTokenCost;
			return {
				path: r.filepath,
				tokens,
				fullTokens,
				layer: hasLayer ? r.layer : null,
				escalated: r.escalated,
				role: r.role,
			};
		}),
	);

	const alwaysIncludeFileCosts: FileTokenInfo[] = allCosts.filter(
		(c) => c.role === "always-include",
	);
	const contextFileCosts: FileTokenInfo[] = allCosts.filter((c) => c.role === "chunk");
	const alwaysIncludeTotal = alwaysIncludeFileCosts.reduce((s, f) => s + f.tokens, 0);
	const contextFilesTotal = contextFileCosts.reduce((s, f) => s + f.tokens, 0);

	// Tokens saved by loading reduced layers instead of full source.
	const layeredSavings = allCosts.reduce((s, f) => s + (f.fullTokens - f.tokens), 0);

	const totalTokens = sessionStateTokens + planChunkTokens + alwaysIncludeTotal + contextFilesTotal;
	const budgetCap = DEFAULT_CONTEXT_BUDGET;
	const overBudget = totalTokens > budgetCap;
	const accurate = false; // heuristic only

	// Build bootstrap context for prompt generation (layered cost).
	const budget = ContextBudgetCalculator.estimateLayered(state, chunk, resolved);
	const projectName = detectProjectName(options.cwd);

	const {
		adapter,
		tool: _detectedTool,
		source: _source,
	} = resolveAdapter(options.cwd, options.adapter);

	let transformedState = state;
	if (adapter.transformState) {
		const readFile = createAdapterReadFile(options.cwd);
		transformedState = adapter.transformState(state, {
			projectRoot: options.cwd,
			sessionDir,
			readFile,
		});
	}

	const bootstrapContext: BootstrapContext = {
		state: transformedState,
		chunk,
		chunkFiles,
		alwaysIncludeFiles: alwaysInclude,
		budget,
		excludePatterns,
		projectName,
		...(aiIndex !== null ? { resolvedLayers: resolved } : {}),
	};

	const promptText = NextPromptWriter.generateWithFormatter(adapter.formatter, bootstrapContext);

	const breakdown: TokenBreakdownEntry[] = [
		{
			label: "SESSION_STATE.md",
			tokens: sessionStateTokens,
			percent: Math.round((sessionStateTokens / totalTokens) * 100),
		},
		{
			label: `Active plan chunk (PLAN_${String(state.active_chunk)}.md)`,
			tokens: planChunkTokens,
			percent: Math.round((planChunkTokens / totalTokens) * 100),
		},
		{
			label: `Always-include files (${String(alwaysIncludeFileCosts.length)})`,
			tokens: alwaysIncludeTotal,
			percent: Math.round((alwaysIncludeTotal / totalTokens) * 100),
			files: alwaysIncludeFileCosts,
		},
		{
			label: `Context files (${String(contextFileCosts.length)})`,
			tokens: contextFilesTotal,
			percent: Math.round((contextFilesTotal / totalTokens) * 100),
			files: contextFileCosts,
		},
	];

	// JSON output
	if (options.format === "json") {
		const output: PreviewJson = {
			total_tokens: totalTokens,
			budget_cap: budgetCap,
			over_budget: overBudget,
			accurate,
			components: {
				session_state: { tokens: sessionStateTokens, file: ".session/SESSION_STATE.md" },
				plan_chunk: {
					tokens: planChunkTokens,
					file: `.session/PLAN_${String(state.active_chunk)}.md`,
				},
				always_include: { tokens: alwaysIncludeTotal, files: alwaysIncludeFileCosts },
				context_files: { tokens: contextFilesTotal, files: contextFileCosts },
				excluded_files: excludedPaths,
			},
			layered_savings: layeredSavings,
			prompt_text: options.noContent ? "" : promptText,
			heuristic_warning: !accurate,
		};
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return;
	}

	// Text output
	if (!accurate) {
		log.warn("Token counts are approximate (heuristic: 1 token ≈ 4 bytes). No API key used.");
	}

	if (excludedPaths.length > 0) {
		log.info(
			`Trim overrides active: ${String(excludedPaths.length)} file(s) excluded from context.`,
		);
	}

	const table = renderBreakdownTable(breakdown, totalTokens, budgetCap, overBudget, accurate);
	process.stdout.write(`\n${table}\n`);

	if (aiIndex === null) {
		log.info(
			"No ai-index.yaml — files counted at full size. Run `dev-sesssion index` to enable layered loading.",
		);
	} else if (layeredSavings > 0) {
		log.info(
			`Layered loading saves ~${String(layeredSavings)} tokens vs. full source. ` +
				"Files marked Ln load at a reduced layer; * = escalated by an active task.",
		);
	}

	if (overBudget) {
		log.warn(
			`Context is over budget. Run \`dev-sesssion trim --budget ${String(budgetCap)}\` to reduce.`,
		);
	}

	if (!options.noContent) {
		process.stdout.write("\n── Assembled prompt ──────────────────────────────────────\n\n");
		process.stdout.write(promptText);
		process.stdout.write("\n──────────────────────────────────────────────────────────\n");
	}

	if (options.copy) {
		try {
			const { default: clipboardy } = await import("clipboardy");
			await clipboardy.write(promptText);
			log.success("Copied assembled prompt to clipboard.");
		} catch {
			log.warn("Failed to copy to clipboard. The `clipboardy` package may not be available.");
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve and validate the .session/ directory path.
 *
 * @param cwd - Working directory
 * @returns ValidatedPath to .session/
 * @throws CliError if .session/ does not exist
 */
function resolveSessionDir(cwd: string): ValidatedPath {
	const sessionDir = path.join(cwd, ".session");

	if (!fs.existsSync(sessionDir)) {
		throw new CliError({
			message: "No .session/ directory found",
			suggestion: "Run `dev-sesssion init` first to initialize the project.",
		});
	}

	return PathValidator.safeResolvePath(".session", cwd);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `preview` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerPreviewCommand(program: Command): void {
	program
		.command("preview")
		.description("Show token breakdown and assembled bootstrap prompt")
		.option("--format <format>", "Output format: text or json", "text")
		.option("--copy", "Copy assembled prompt to clipboard", false)
		.option("--no-content", "Show breakdown only, suppress prompt text")
		.action(async (cmdOptions: { format?: string; copy?: boolean; content?: boolean }) => {
			const opts = program.opts<{
				cwd: string;
				verbose: boolean;
				adapter?: string;
			}>();

			const previewOptions: PreviewOptions = {
				cwd: opts.cwd,
				format: cmdOptions.format === "json" ? "json" : "text",
				copy: cmdOptions.copy ?? false,
				noContent: cmdOptions.content === false,
				verbose: opts.verbose,
				...(opts.adapter !== undefined ? { adapter: opts.adapter } : {}),
			};

			try {
				await runPreview(previewOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
