/**
 * Units eval — deterministic, no API key (LLD-code-units.md, REQ-UNIT-26..29).
 *
 * Drives the packed workspace build (or a published version) over two targets:
 * a small fixture, and a copy of this repository's own `packages/core/src` —
 * real, hand-maintained code. Each target runs init → index → a series of
 * task scenarios → update, then edits a focused unit and runs verify.
 *
 * The copy of core lives in a temp directory; the tool is never run against
 * this repository.
 *
 * Usage: `pnpm eval:units [--version 2.3.0] [--keep]` (default: `--local`)
 *
 * @module
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	checkFocusGrounding,
	checkHashFidelity,
	type FocusRef,
	type IndexUnit,
	parseFocusRefs,
	parseIndexUnits,
	type Reduction,
	summarizeReduction,
} from "./checks/units.js";
import {
	type InstalledCli,
	installLocalCli,
	installPublishedCli,
} from "./harness/published-cli.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A plan whose tasks name units, and the refs the prompt must focus. */
interface Scenario {
	readonly id: string;
	readonly tasks: readonly string[];
	/** `path#id` refs, order-insensitive. Empty means "focus nothing". */
	readonly expect: readonly string[];
	/** Refs chosen among same-named declarations: each must carry evidence (REQ-UNIT-33). */
	readonly contested?: readonly string[];
}

/** A codebase to run scenarios over. */
interface UnitTarget {
	readonly id: string;
	/** Copies the target's source into an empty directory. */
	prepare(dir: string): Promise<void>;
	readonly scenarios: readonly Scenario[];
}

/** Directories never copied. */
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", "__tests__", ".session"]);

/**
 * Copies a tree, skipping build output, tests and session state.
 *
 * @param from - Source directory.
 * @param to - Destination directory.
 */
async function copyTree(from: string, to: string): Promise<void> {
	await fs.cp(from, to, {
		recursive: true,
		filter: (src) => !SKIP.has(path.basename(src)) && !src.endsWith(".test.ts"),
	});
}

const TARGETS: readonly UnitTarget[] = [
	{
		id: "simple-node-app",
		prepare: (dir) => copyTree(path.join(REPO_ROOT, "tests/fixtures/simple-node-app"), dir),
		scenarios: [
			{
				id: "camel-case",
				tasks: ["Make requireAuth accept a comma-separated API_TOKEN list"],
				expect: ["src/middleware/auth.ts#requireAuth"],
			},
			{
				id: "two-units",
				tasks: ["parseBody should list every issue", "AppError should carry a machine code"],
				expect: ["src/utils/validate.ts#parseBody", "src/utils/errors.ts#AppError"],
			},
			{
				id: "schema-const",
				tasks: ["Validate PUT bodies with UpdateUserSchema"],
				expect: ["src/models/user.ts#UpdateUserSchema"],
			},
			{
				id: "prose-only",
				tasks: ["Add request logging middleware", "Write unit tests for routes"],
				expect: [],
			},
		],
	},
	{
		id: "core-src",
		prepare: async (dir) => {
			await copyTree(path.join(REPO_ROOT, "packages/core/src"), path.join(dir, "src"));
			// Real core has no duplicate the code fails to use, so two unused
			// twins are planted to exercise the refusal path (REQ-UNIT-32).
			await fs.mkdir(path.join(dir, "src", "eval-twins"));
			for (const twin of ["a", "b"]) {
				await fs.writeFile(
					path.join(dir, "src", "eval-twins", `${twin}.ts`),
					"export function unusedTwin(): void {}\n",
				);
			}
			await fs.writeFile(
				path.join(dir, "package.json"),
				`${JSON.stringify({ name: "core-src-copy", private: true, version: "0.0.0" })}\n`,
			);
		},
		scenarios: [
			{
				id: "function",
				tasks: ["Make extractDeclaredFiles ignore fenced code blocks"],
				expect: ["src/verifiers/replay-scorer.ts#extractDeclaredFiles"],
			},
			{
				id: "qualified-member",
				// `trimToMaxLines` is declared twice: exported from formatter-utils.ts
				// and imported by three files, and a private copy next-prompt-writer.ts
				// calls itself. Both are proven used, so both are focused (REQ-UNIT-30).
				tasks: ["LayerResolver.plan should cap focus per file; trimToMaxLines must keep Focus"],
				expect: [
					"src/calculators/layer-resolver.ts#LayerResolver.plan",
					"src/formatters/formatter-utils.ts#trimToMaxLines",
					"src/managers/next-prompt-writer.ts#trimToMaxLines",
				],
				contested: [
					"src/formatters/formatter-utils.ts#trimToMaxLines",
					"src/managers/next-prompt-writer.ts#trimToMaxLines",
				],
			},
			{
				id: "proven-duplicates",
				// Private constants in two files, each read in its own file. Was
				// MAX_FILES_TO_SHOW until LLD-prompt-context.md removed those copies.
				tasks: ["Change BYTES_PER_TOKEN to 3.5"],
				expect: [
					"src/calculators/context-budget-calculator.ts#BYTES_PER_TOKEN",
					"src/counters/token-counter.ts#BYTES_PER_TOKEN",
				],
				contested: [
					"src/calculators/context-budget-calculator.ts#BYTES_PER_TOKEN",
					"src/counters/token-counter.ts#BYTES_PER_TOKEN",
				],
			},
			{
				id: "unproven-twins",
				tasks: ["Delete unusedTwin"],
				expect: [],
			},
			{
				id: "backticked",
				tasks: ["`contentHash` should accept a Buffer"],
				expect: ["src/annotation/unit-extractor.ts#contentHash"],
			},
		],
	},
];

/** Outcome of one scenario. */
interface ScenarioRow {
	readonly target: string;
	readonly scenario: string;
	readonly expected: readonly string[];
	readonly focused: readonly string[];
	readonly focusOk: boolean;
	readonly ungrounded: readonly string[];
	readonly promptHashOk: boolean;
	readonly manifestMatchesPrompt: boolean;
	/** Contested refs whose manifest entry lacks evidence. */
	readonly missingEvidence: readonly string[];
	readonly reduction: Reduction;
}

/** Outcome of one target. */
interface TargetRow {
	readonly target: string;
	readonly files: number;
	readonly units: number;
	readonly exportedUnits: number;
	readonly fidelityChecked: number;
	readonly fidelityMismatches: readonly string[];
	readonly scenarios: readonly ScenarioRow[];
	readonly staleDetected: boolean;
	readonly movedDetected: boolean;
}

/**
 * Runs the CLI, failing loudly on a non-zero exit.
 *
 * @param cli - The installed CLI.
 * @param args - Arguments.
 * @param dir - Working directory.
 * @returns stdout.
 */
async function must(cli: InstalledCli, args: readonly string[], dir: string): Promise<string> {
	const r = await cli.run(args, dir);
	if (r.exitCode !== 0)
		throw new Error(`${args.join(" ")} exited ${String(r.exitCode)}: ${r.stderr}`);
	return r.stdout;
}

/**
 * Replaces the active chunk's task list in PLAN_1.md.
 *
 * @param dir - Workspace.
 * @param tasks - Task texts.
 */
async function setTasks(dir: string, tasks: readonly string[]): Promise<void> {
	const planPath = path.join(dir, ".session", "PLAN_1.md");
	const plan = await fs.readFile(planPath, "utf8");
	const yaml = tasks.map((t) => `  - text: ${JSON.stringify(t)}\n    status: todo`).join("\n");
	await fs.writeFile(planPath, plan.replace(/tasks:\n(?: {2}.*\n)+/, `tasks:\n${yaml}\n`));
}

/**
 * Reads a file relative to the workspace, or null.
 *
 * @param dir - Workspace.
 * @param rel - Relative path.
 * @returns Contents or null.
 */
async function readRel(dir: string, rel: string): Promise<string | null> {
	try {
		return await fs.readFile(path.join(dir, rel), "utf8");
	} catch {
		return null;
	}
}

/**
 * Runs one scenario and checks what the CLI generated.
 *
 * @param cli - The installed CLI.
 * @param dir - Workspace.
 * @param target - Target id.
 * @param s - The scenario.
 * @param rows - Index units.
 * @returns The scenario's row, and the refs it focused.
 */
async function runScenario(
	cli: InstalledCli,
	dir: string,
	target: string,
	s: Scenario,
	rows: readonly IndexUnit[],
): Promise<{ row: ScenarioRow; refs: FocusRef[] }> {
	await setTasks(dir, s.tasks);
	await must(cli, ["--yes", "--adapter", "claude", "update"], dir);
	const prompt = (await readRel(dir, ".session/NEXT_PROMPT.md")) ?? "";
	const manifest = JSON.parse((await readRel(dir, ".session/context-manifest.json")) ?? "{}");
	const refs = parseFocusRefs(prompt);
	const focused = refs.map((r) => `${r.path}#${r.id}`);
	const unitEntries: { ref: string; evidence?: string }[] = (manifest.entries ?? []).filter(
		(e: { granularity: string }) => e.granularity === "unit",
	);
	const manifestUnits = unitEntries.map((e) => e.ref);
	const missingEvidence = (s.contested ?? []).filter(
		(ref) => !unitEntries.some((e) => e.ref === ref && (e.evidence ?? "") !== ""),
	);
	const promptHash = createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 16);
	const row: ScenarioRow = {
		target,
		scenario: s.id,
		expected: s.expect,
		focused,
		focusOk: sameSet(focused, s.expect),
		ungrounded: checkFocusGrounding(refs, rows),
		promptHashOk: manifest.prompt_hash === promptHash,
		manifestMatchesPrompt: sameSet(manifestUnits, focused),
		missingEvidence,
		reduction: summarizeReduction(manifest),
	};
	return { row, refs };
}

/**
 * Order-insensitive equality of two string lists.
 *
 * @param a - First list.
 * @param b - Second list.
 * @returns Whether they hold the same members.
 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
}

/**
 * Edits a focused unit, then shifts it, and asks `verify` about each (REQ-UNIT-20, -21).
 *
 * @param cli - The installed CLI.
 * @param dir - Workspace.
 * @param ref - A focused unit spanning at least two lines.
 * @returns Whether each drift was reported.
 */
async function checkStaleness(
	cli: InstalledCli,
	dir: string,
	ref: FocusRef,
): Promise<{ stale: boolean; moved: boolean }> {
	const file = path.join(dir, ref.path);
	const original = await fs.readFile(file, "utf8");
	const codes = async (): Promise<string[]> => {
		const out = (await cli.run(["verify", "--json"], dir)).stdout;
		return (JSON.parse(out) as { findings: { code: string }[] }).findings.map((f) => f.code);
	};
	try {
		const lines = original.split("\n");
		lines.splice(ref.end - 1, 0, "// eval: edited inside the unit");
		await fs.writeFile(file, lines.join("\n"));
		const stale = (await codes()).includes("STALE_CONTEXT");
		await fs.writeFile(file, `// eval: shifted\n${original}`);
		const afterShift = await codes();
		const moved = afterShift.includes("MOVED_CONTEXT") && !afterShift.includes("STALE_CONTEXT");
		return { stale, moved };
	} finally {
		await fs.writeFile(file, original);
	}
}

/**
 * Runs every scenario of a target in one fresh workspace.
 *
 * @param cli - The installed CLI.
 * @param target - The target.
 * @param keep - Leave the workspace on disk.
 * @returns The target's row.
 */
async function runTarget(cli: InstalledCli, target: UnitTarget, keep: boolean): Promise<TargetRow> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `dev-sesssion-units-${target.id}-`));
	try {
		await target.prepare(dir);
		await must(cli, ["--yes", "--adapter", "claude", "init"], dir);
		await must(cli, ["index"], dir);
		const rows = parseIndexUnits((await readRel(dir, ".session/ai-index.yaml")) ?? "");
		const sources = new Map<string, string | null>();
		for (const p of new Set(rows.map((r) => r.path))) sources.set(p, await readRel(dir, p));
		const fidelity = checkHashFidelity(rows, (p) => sources.get(p) ?? null);

		const scenarios: ScenarioRow[] = [];
		let staleness = { stale: false, moved: false };
		for (const s of target.scenarios) {
			const { row, refs } = await runScenario(cli, dir, target.id, s, rows);
			scenarios.push(row);
			const multiLine = refs.find((r) => r.end > r.start);
			if (scenarios.length === 1 && multiLine)
				staleness = await checkStaleness(cli, dir, multiLine);
		}
		return {
			target: target.id,
			files: sources.size,
			units: rows.length,
			exportedUnits: rows.filter((r) => r.exported).length,
			fidelityChecked: fidelity.checked,
			fidelityMismatches: fidelity.mismatches,
			scenarios,
			staleDetected: staleness.stale,
			movedDetected: staleness.moved,
		};
	} finally {
		if (keep) process.stdout.write(`  kept: ${dir}\n`);
		else await fs.rm(dir, { recursive: true, force: true });
	}
}

/**
 * Lists every failed gate in a target row (REQ-UNIT-29).
 *
 * @param t - The target row.
 * @returns Human-readable failures; empty when the target passed.
 */
function failures(t: TargetRow): string[] {
	const out: string[] = [];
	if (t.units === 0) out.push(`${t.target}: index holds no units`);
	if (t.fidelityMismatches.length > 0) {
		out.push(`${t.target}: hash mismatch ${t.fidelityMismatches.slice(0, 5).join(", ")}`);
	}
	if (!t.staleDetected) out.push(`${t.target}: verify missed an edited unit (STALE_CONTEXT)`);
	if (!t.movedDetected) out.push(`${t.target}: verify missed a shifted unit (MOVED_CONTEXT)`);
	for (const s of t.scenarios) {
		const id = `${t.target}/${s.scenario}`;
		if (!s.focusOk)
			out.push(`${id}: focused [${s.focused.join(", ")}], expected [${s.expected.join(", ")}]`);
		if (s.ungrounded.length > 0) out.push(`${id}: ungrounded ${s.ungrounded.join(", ")}`);
		if (!s.promptHashOk) out.push(`${id}: manifest prompt_hash does not match NEXT_PROMPT.md`);
		if (!s.manifestMatchesPrompt) out.push(`${id}: manifest units differ from the Focus line`);
		if (s.missingEvidence.length > 0)
			out.push(`${id}: no evidence recorded for ${s.missingEvidence.join(", ")}`);
	}
	return out;
}

/**
 * Formats a ratio as a percentage, or `n/a`.
 *
 * @param r - Ratio or null.
 * @returns Display string.
 */
function pct(r: number | null): string {
	return r === null ? "n/a" : `${(r * 100).toFixed(1)}%`;
}

/**
 * Prints one target's results.
 *
 * @param t - The target row.
 */
function printTarget(t: TargetRow): void {
	const w = (s: string): boolean => process.stdout.write(s);
	w(
		`▸ ${t.target}: ${String(t.files)} files · ${String(t.units)} units (${String(t.exportedUnits)} exported)\n`,
	);
	w(
		`  hash fidelity ${String(t.fidelityChecked - t.fidelityMismatches.length)}/${String(t.fidelityChecked)}`,
	);
	w(` · verify stale=${String(t.staleDetected)} moved=${String(t.movedDetected)}\n`);
	for (const s of t.scenarios) {
		const r = s.reduction;
		w(`  ${s.focusOk ? "✓" : "✗"} ${s.scenario.padEnd(16)} focus ${String(s.focused.length)}`);
		w(` · unit ${String(r.unitTokens)}/${String(r.unitFileTokens)} tok (${pct(r.unitRatio)})`);
		w(` · manifest ${pct(r.manifestRatio)} of whole files\n`);
	}
}

/**
 * Entry point.
 *
 * @returns Resolves when the report is written.
 */
async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const vIdx = argv.indexOf("--version");
	const version = vIdx !== -1 ? argv[vIdx + 1] : undefined;
	const keep = argv.includes("--keep");

	process.stdout.write(
		version ? `Installing dev-sesssion@${version}...\n` : "Packing workspace build...\n",
	);
	const cli = version ? await installPublishedCli(version) : await installLocalCli(REPO_ROOT);

	const targets: TargetRow[] = [];
	for (const target of TARGETS) {
		const row = await runTarget(cli, target, keep);
		printTarget(row);
		targets.push(row);
	}

	const reportDir = path.join(REPO_ROOT, "evals", "report");
	await fs.mkdir(reportDir, { recursive: true });
	const out = path.join(reportDir, `units-${cli.version}.json`);
	await fs.writeFile(
		out,
		`${JSON.stringify({ version: cli.version, targets }, null, 2)}\n`,
		"utf8",
	);
	process.stdout.write(`\nReport: ${path.relative(REPO_ROOT, out)}\n`);

	const failed = targets.flatMap(failures);
	if (failed.length > 0) {
		process.stdout.write(
			`\nFAILED (${String(failed.length)}):\n${failed.map((f) => `  - ${f}`).join("\n")}\n`,
		);
		process.exitCode = 1;
	}
}

main().catch((err: unknown) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exitCode = 1;
});
