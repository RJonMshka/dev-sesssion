/**
 * Core measurement functions for the dev-sesssion token savings benchmark.
 *
 * measureBaseline()          — counts tokens for every non-ignored file ("WITHOUT tool")
 * measureWithTool()          — runs dev-sesssion and reads its context budget ("WITH tool")
 * measureDeveloperPatterns() — models how a developer would manually load context
 * measureNextPrompt()        — counts tokens in the generated NEXT_PROMPT.md handoff
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Use compiled core package — avoids TypeScript compilation overhead at benchmark time
type Walker = { walk: (dir: string) => Array<{ relativePath: string; sizeBytes: number }> };
const { GitignoreAwareWalker } = (await import(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../packages/core/dist/index.mjs")
)) as { GitignoreAwareWalker: Walker };

import { runCli } from "../helpers/run-cli.js";
import type { DeveloperPattern, TokenReport } from "./types.js";

type WalkedFile = { relativePath: string; sizeBytes: number };

/** Files inside .session/ are excluded from the baseline (they're the tool's own state). */
const SESSION_DIR_PATTERN = /[/\\]\.session[/\\]/;

/** Bytes-per-token heuristic — same as ContextBudgetCalculator. */
function tokenize(sizeBytes: number): number {
	return Math.ceil(sizeBytes / 4);
}

function sumTokens(files: WalkedFile[]): number {
	return files.reduce((s, f) => s + tokenize(f.sizeBytes), 0);
}

// ---------------------------------------------------------------------------
// Baseline ("WITHOUT tool")
// ---------------------------------------------------------------------------

/**
 * Measure "WITHOUT tool" — total tokens to load every non-ignored file.
 *
 * Uses the same bytes/4 heuristic as dev-sesssion's ContextBudgetCalculator.
 */
export async function measureBaseline(projectDir: string): Promise<TokenReport> {
	const files = GitignoreAwareWalker.walk(projectDir);

	const relevant = files.filter((f) => !SESSION_DIR_PATTERN.test(f.relativePath));

	const withTokens = relevant.map((f) => ({
		path: f.relativePath,
		tokens: tokenize(f.sizeBytes),
	}));

	const totalTokens = withTokens.reduce((sum, f) => sum + f.tokens, 0);

	const topFiles = [...withTokens].sort((a, b) => b.tokens - a.tokens).slice(0, 10);

	return {
		totalTokens,
		fileCount: relevant.length,
		topFiles,
		accurate: false,
	};
}

// ---------------------------------------------------------------------------
// "WITH tool" — dev-sesssion context budget
// ---------------------------------------------------------------------------

/**
 * Measure "WITH tool" — dev-sesssion's context budget for the active chunk.
 *
 * Runs `dev-sesssion init --yes` if .session/ doesn't exist, then reads
 * `status --json` to get the budget.
 *
 * @returns Token report + whether init was run.
 */
export async function measureWithTool(
	projectDir: string,
	skipInit: boolean,
): Promise<{ report: TokenReport; initialized: boolean }> {
	const sessionDir = path.join(projectDir, ".session");
	let initialized = false;

	if (!skipInit && !fs.existsSync(sessionDir)) {
		const initResult = await runCli(["init", "--yes", "--cwd", projectDir]);
		if (!initResult.ok) {
			throw new Error(`dev-sesssion init failed:\n${initResult.stderr}`);
		}
		initialized = true;
	}

	const statusResult = await runCli(["status", "--json", "--cwd", projectDir]);
	if (!statusResult.ok) {
		throw new Error(`dev-sesssion status --json failed:\n${statusResult.stderr}`);
	}

	let statusJson: {
		budget: { total_tokens: number; accurate: boolean };
		files: { context: number };
	};

	try {
		statusJson = JSON.parse(statusResult.stdout) as typeof statusJson;
	} catch {
		throw new Error(`Failed to parse status --json output:\n${statusResult.stdout}`);
	}

	return {
		report: {
			totalTokens: statusJson.budget.total_tokens,
			fileCount: statusJson.files.context,
			topFiles: [], // not available from status --json
			accurate: statusJson.budget.accurate,
		},
		initialized,
	};
}

// ---------------------------------------------------------------------------
// CLI command health checks
// ---------------------------------------------------------------------------

/**
 * Run the 4 CLI command checks and return pass/fail for each.
 */
export async function runCommandChecks(projectDir: string): Promise<{
	statusOk: boolean;
	healthOk: boolean;
	promptOk: boolean;
	exportClaudeOk: boolean;
}> {
	const [statusR, healthR, promptR, exportR] = await Promise.all([
		runCli(["status", "--cwd", projectDir]),
		runCli(["health", "--cwd", projectDir]),
		runCli(["prompt", "--cwd", projectDir]),
		runCli(["export", "--to", "claude", "--cwd", projectDir]),
	]);

	return {
		statusOk: statusR.ok,
		// health exits 1 when there are warnings — that's expected, not a failure
		healthOk: statusR.ok && (healthR.exitCode === 0 || healthR.exitCode === 1),
		promptOk: promptR.ok && promptR.stdout.trim().length > 0,
		exportClaudeOk: exportR.ok,
	};
}

// ---------------------------------------------------------------------------
// Developer pattern helpers
// ---------------------------------------------------------------------------

/** Return files whose relativePath basename matches a PLAN.md pattern. */
function findPlanFiles(allFiles: WalkedFile[]): WalkedFile[] {
	return allFiles.filter((f) => {
		const name = path.basename(f.relativePath);
		const dir = path.dirname(f.relativePath);
		return dir === "." && /^PLAN(_\d+)?\.md$/i.test(name);
	});
}

/**
 * Return root-level config/documentation files a developer would typically
 * load to orient themselves in a project.
 */
function findStandardContextFiles(allFiles: WalkedFile[]): WalkedFile[] {
	const ROOT_NAMES = new Set([
		"readme.md",
		"package.json",
		"tsconfig.json",
		"tsconfig.base.json",
		"pnpm-workspace.yaml",
		".npmrc",
		".nvmrc",
	]);
	return allFiles.filter((f) => {
		const dir = path.dirname(f.relativePath);
		return dir === "." && ROOT_NAMES.has(path.basename(f.relativePath).toLowerCase());
	});
}

/**
 * Parse PLAN.md (or PLAN_1.md) and return the task descriptions for the first
 * incomplete chunk (first chunk with any unchecked tasks).
 */
function getActivePlanTasks(projectDir: string): string[] {
	const candidates = ["PLAN.md", "PLAN_1.md"].map((p) => path.join(projectDir, p));
	for (const p of candidates) {
		if (!fs.existsSync(p)) continue;
		const content = fs.readFileSync(p, "utf8");

		// Split into per-chunk sections, find first with unchecked items
		const sections = content.split(/(?=^## Chunk )/m);
		for (const section of sections) {
			const tasks = [...section.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1] ?? "");
			if (tasks.length > 0) return tasks;
		}
	}
	return [];
}

/**
 * From task descriptions, extract directory-segment keywords that imply which
 * areas of the codebase the developer would navigate to.
 *
 * E.g. "Add authentication middleware (JWT)" → ['middleware', 'auth']
 */
function extractDirSegments(tasks: string[]): Set<string> {
	const text = tasks.join(" ").toLowerCase();
	const segments = new Set<string>();

	const KEYWORD_MAP: Array<[RegExp, string[]]> = [
		[/middleware/, ["middleware"]],
		[/\broutes?\b/, ["routes"]],
		[/controllers?/, ["controllers"]],
		[/\bmodels?\b/, ["models"]],
		[/\butils?\b/, ["utils"]],
		[/\btests?\b|unit test|integration test/, ["tests", "__tests__"]],
		[/\bconfig\b/, ["config"]],
		[/\bshared\b/, ["shared"]],
		[/\bauth\b|\bjwt\b/, ["middleware", "auth"]],
		[/\blogger\b|logging/, ["logger"]],
		[/validat/, ["validation", "validators"]],
	];

	for (const [re, segs] of KEYWORD_MAP) {
		if (re.test(text)) {
			for (const seg of segs) segments.add(seg);
		}
	}

	// Extract explicit package references like "packages/shared" or "packages/config"
	for (const m of text.matchAll(/packages\/([\w-]+)/g)) {
		if (m[1]) segments.add(m[1]);
	}

	return segments;
}

/** Return files whose path contains at least one of the given directory segments. */
function filterByDirSegments(allFiles: WalkedFile[], segments: Set<string>): WalkedFile[] {
	if (segments.size === 0) return [];
	return allFiles.filter((f) =>
		f.relativePath.split(/[/\\]/).some((part) => segments.has(part.toLowerCase())),
	);
}

/** Merge two file arrays, deduplicating by relativePath. */
function mergeFiles(a: WalkedFile[], b: WalkedFile[]): WalkedFile[] {
	const seen = new Set(a.map((f) => f.relativePath));
	const extras = b.filter((f) => !seen.has(f.relativePath));
	return [...a, ...extras];
}

// ---------------------------------------------------------------------------
// Developer patterns — public API
// ---------------------------------------------------------------------------

/**
 * Model four realistic ways a developer might manually load context before
 * starting the next phase of work.
 *
 * Patterns (ascending token cost):
 *   plan-only        — read PLAN.md to understand tasks
 *   standard-context — PLAN.md + README + root config files
 *   task-scoped      — above + dirs implied by task-description keywords
 *   whole-project    — dump every non-ignored file
 *
 * Must be called after measureWithTool() so .session/ exists (for task parsing
 * to have file index context if needed).
 *
 * @param projectDir Absolute path to the project root.
 * @returns Array of DeveloperPattern sorted by ascending token count.
 */
export async function measureDeveloperPatterns(projectDir: string): Promise<DeveloperPattern[]> {
	const allFiles = GitignoreAwareWalker.walk(projectDir).filter(
		(f) => !SESSION_DIR_PATTERN.test(f.relativePath),
	);

	// 1. plan-only
	const planFiles = findPlanFiles(allFiles);

	// 2. standard-context: plan + root README + root config files
	const stdFiles = mergeFiles(planFiles, findStandardContextFiles(allFiles));

	// 3. task-scoped: standard + dirs implied by active chunk keywords
	const tasks = getActivePlanTasks(projectDir);
	const segments = extractDirSegments(tasks);
	const taskFiles = filterByDirSegments(allFiles, segments);
	const taskScopedFiles = mergeFiles(stdFiles, taskFiles);

	// 4. whole-project
	const totalTokens = sumTokens(allFiles);

	return [
		{
			name: "plan-only",
			description: 'Read PLAN.md: "What do I need to do?"',
			tokens: sumTokens(planFiles),
			fileCount: planFiles.length,
		},
		{
			name: "standard-context",
			description: "PLAN.md + README + root configs (package.json, tsconfig…)",
			tokens: sumTokens(stdFiles),
			fileCount: stdFiles.length,
		},
		{
			name: "task-scoped",
			description: "Standard context + dirs implied by task keywords (middleware, routes…)",
			tokens: sumTokens(taskScopedFiles),
			fileCount: taskScopedFiles.length,
		},
		{
			name: "whole-project",
			description: "Dump everything — all non-ignored files",
			tokens: totalTokens,
			fileCount: allFiles.length,
		},
	];
}

/**
 * Count tokens in the NEXT_PROMPT.md handoff that dev-sesssion generates.
 *
 * Returns zeros if the file doesn't exist (session not yet initialized).
 *
 * @param projectDir Absolute path to the project root.
 */
export async function measureNextPrompt(
	projectDir: string,
): Promise<{ tokens: number; lines: number }> {
	const p = path.join(projectDir, ".session", "NEXT_PROMPT.md");
	if (!fs.existsSync(p)) return { tokens: 0, lines: 0 };
	const content = fs.readFileSync(p, "utf8");
	const nonEmptyLines = content.split("\n").filter((l) => l.trim().length > 0).length;
	return {
		tokens: Math.ceil(Buffer.byteLength(content, "utf8") / 4),
		lines: nonEmptyLines,
	};
}
