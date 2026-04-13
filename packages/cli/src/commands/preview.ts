/**
 * `dev-session preview` command.
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
	type BootstrapContext,
	ContextBudgetCalculator,
	DEFAULT_CONTEXT_BUDGET,
	FileIndexManager,
	NextPromptWriter,
	PlanChunkManager,
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

/** Per-component token info. */
export interface TokenBreakdownEntry {
	readonly label: string;
	readonly tokens: number;
	readonly percent: number;
	readonly files?: ReadonlyArray<{ path: string; tokens: number }>;
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
			files: ReadonlyArray<{ path: string; tokens: number }>;
		};
		readonly context_files: {
			tokens: number;
			files: ReadonlyArray<{ path: string; tokens: number }>;
		};
		readonly excluded_files: readonly string[];
	};
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
				const shortPath =
					f.path.length > LABEL_WIDTH - 4 ? `…${f.path.slice(-(LABEL_WIDTH - 5))}` : f.path;
				lines.push(
					`  ${shortPath.padEnd(LABEL_WIDTH - 2)} ${(prefix + String(f.tokens)).padStart(TOKEN_WIDTH)} ${filePct.padStart(PCT_WIDTH)}`,
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

	// Load session data
	const state = SessionStateManager.load(sessionDir);
	const chunk = PlanChunkManager.loadActive(sessionDir, state);
	const allEntries = FileIndexManager.load(sessionDir);
	const alwaysInclude = FileIndexManager.alwaysInclude(allEntries);
	let chunkFiles = FileIndexManager.queryByChunk(allEntries, state.active_chunk);

	// Apply trim overrides
	const trimOverrides = TrimOverridesManager.load(sessionDir);
	const excludedPaths = TrimOverridesManager.getExcludedPaths(trimOverrides);
	if (excludedPaths.length > 0) {
		chunkFiles = chunkFiles.filter(
			(f) => !TrimOverridesManager.isExcluded(trimOverrides, f.filepath),
		);
	}

	// Build exclude patterns for the adapter formatter
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

	// Token counts for always-include files
	const alwaysIncludeFileCosts = await Promise.all(
		alwaysInclude.map(async (entry) => {
			const content = safeReadFile(path.join(options.cwd, entry.filepath));
			const tokens = (await counter.countString(content)).tokens;
			return { path: entry.filepath, tokens };
		}),
	);
	const alwaysIncludeTotal = alwaysIncludeFileCosts.reduce((s, f) => s + f.tokens, 0);

	// Token counts for context files
	const contextFileCosts = await Promise.all(
		chunkFiles.map(async (entry) => {
			const content = safeReadFile(path.join(options.cwd, entry.filepath));
			const tokens = (await counter.countString(content)).tokens;
			return { path: entry.filepath, tokens };
		}),
	);
	const contextFilesTotal = contextFileCosts.reduce((s, f) => s + f.tokens, 0);

	const totalTokens = sessionStateTokens + planChunkTokens + alwaysIncludeTotal + contextFilesTotal;
	const budgetCap = DEFAULT_CONTEXT_BUDGET;
	const overBudget = totalTokens > budgetCap;
	const accurate = false; // heuristic only

	// Build bootstrap context for prompt generation
	const budget = ContextBudgetCalculator.estimate(state, chunk, chunkFiles, alwaysInclude);
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
	};

	const promptText = NextPromptWriter.generateWithFormatter(adapter.formatter, bootstrapContext);

	// ------------------------------------------------------------------
	// Build breakdown table entries
	// ------------------------------------------------------------------
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
			label: `Always-include files (${String(alwaysInclude.length)})`,
			tokens: alwaysIncludeTotal,
			percent: Math.round((alwaysIncludeTotal / totalTokens) * 100),
			files: alwaysIncludeFileCosts,
		},
		{
			label: `Context files (${String(chunkFiles.length)})`,
			tokens: contextFilesTotal,
			percent: Math.round((contextFilesTotal / totalTokens) * 100),
			files: contextFileCosts,
		},
	];

	// ------------------------------------------------------------------
	// JSON output
	// ------------------------------------------------------------------
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
			prompt_text: options.noContent ? "" : promptText,
			heuristic_warning: !accurate,
		};
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return;
	}

	// ------------------------------------------------------------------
	// Text output
	// ------------------------------------------------------------------
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

	if (overBudget) {
		log.warn(
			`Context is over budget. Run \`dev-session trim --budget ${String(budgetCap)}\` to reduce.`,
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
			suggestion: "Run `dev-session init` first to initialize the project.",
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
