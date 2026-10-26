/**
 * Runs the adversarial corpus against an installed CLI (REQ-EVAL-6).
 *
 * Every case gets a fresh git repository at `<tmp>/repo`, so a traversal case
 * has somewhere real to point: `<tmp>/outside.txt`. After `init` and the case's
 * steps, the agent-facing output is scanned — NEXT_PROMPT.md, the managed block
 * of CLAUDE.md, the notes in SESSION_STATE.md, and each command's text output.
 * `ai-index.yaml` is not, because it keeps doc comments as written by design
 * (LLD-context-provenance.md); a case names it in `alsoScan` when it should.
 *
 * Every case also gets three checks it does not have to ask for: each command
 * finishes in time without a stack trace, and no prompt reference leaves the
 * project root.
 *
 * @module
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import {
	type AdversarialCase,
	BASE_PLAN,
	type CorpusStep,
	type ExitExpectation,
} from "../adversarial.js";
import {
	escapingRefs,
	managedBlock,
	type Occurrence,
	scanForMarker,
	stateNotes,
} from "../checks/attribution.js";
import { declaredFromPrompt } from "../checks/grounding.js";
import type { CliResult, InstalledCli } from "./published-cli.js";

const execFileAsync = promisify(execFile);

/** Per-command limit when a case sets none. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** A Node stack frame: `    at fn (file:1:2)` or `    at file:1:2`. */
const STACK_FRAME_RE = /^\s+at .*:\d+:\d+\)?$/m;

/** One case's result. */
export interface AdversarialRow {
	readonly id: string;
	readonly classification: AdversarialCase["classification"];
	/** Why the case failed; empty when it passed. */
	readonly failures: readonly string[];
	/** Every marker occurrence found, attributed or not. */
	readonly occurrences: readonly Occurrence[];
	/** Steps whose command this CLI does not have, e.g. one newer than a release. */
	readonly skipped: readonly string[];
	readonly durationMs: number;
}

/** A command's label and result. */
interface StepOutput {
	readonly label: string;
	readonly expectExit: ExitExpectation;
	readonly result: CliResult;
}

/** Text scanned for the marker. */
interface Surface {
	readonly name: string;
	readonly text: string;
}

/**
 * Writes the base project, the case's plants and outside files, and commits.
 *
 * @param c - The case.
 * @returns The temp root and the repository inside it.
 */
async function buildWorkspace(c: AdversarialCase): Promise<{ root: string; repo: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `dev-sesssion-adv-${c.id}-`));
	const repo = path.join(root, "repo");
	const files = new Map<string, string>([
		["package.json", JSON.stringify({ name: "adversarial", version: "1.0.0" })],
		["src/real.ts", "export const real = 1;\n"],
		["PLAN.md", c.plan ?? BASE_PLAN],
		...c.plant,
	]);
	for (const [rel, content] of files) await writeFile(path.join(repo, rel), content);
	for (const [rel, content] of c.outside ?? []) await writeFile(path.join(root, rel), content);
	const git = (args: readonly string[]) => execFileAsync("git", [...args], { cwd: repo });
	await git(["init", "-q"]);
	await git(["add", "-A"]);
	await git([
		"-c",
		"user.email=eval@dev-sesssion.invalid",
		"-c",
		"user.name=dev-sesssion eval",
		"commit",
		"-qm",
		"base",
	]);
	return { root, repo };
}

/** Writes a file, creating its directory. */
async function writeFile(file: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, content, "utf8");
}

/** Reads a file, or `""` when absent. */
async function readOr(file: string): Promise<string> {
	try {
		return await fs.readFile(file, "utf8");
	} catch {
		return "";
	}
}

/**
 * Runs `init`, then each step.
 *
 * @param cli - The CLI under test.
 * @param repo - Repository root.
 * @param c - The case.
 * @returns Each command's output, `init` first.
 */
async function runSteps(
	cli: InstalledCli,
	repo: string,
	c: AdversarialCase,
): Promise<{ outputs: StepOutput[]; skipped: string[] }> {
	const skipped: string[] = [];
	const timeoutMs = c.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const init = ["--yes", "--adapter", "claude", "init"];
	const outputs: StepOutput[] = [
		{
			label: `$ ${init.join(" ")}`,
			expectExit: c.initExit ?? "zero",
			result: await cli.run(init, repo, { timeoutMs }),
		},
	];
	for (const step of c.steps) {
		if (isEdit(step)) {
			const file = path.join(repo, step.edit);
			await fs.writeFile(file, step.apply(await readOr(file)), "utf8");
			continue;
		}
		if (!(await hasCommand(cli, repo, step.run))) {
			skipped.push(`$ ${step.run.join(" ")}`);
			continue;
		}
		const result = await cli.run(step.run, repo, { timeoutMs });
		outputs.push({
			label: `$ ${step.run.join(" ")}`,
			expectExit: step.expectExit ?? "zero",
			result,
		});
	}
	return { outputs, skipped };
}

/** Command names each installed CLI lists, by binary. */
const commandCache = new Map<string, ReadonlySet<string>>();

/**
 * Whether the CLI has the command `args` names. A published release lacks
 * commands built since, and running one would report version skew as an attack
 * result. Read from the top-level `--help`: an unknown command's `--help`
 * prints that same page and exits 0, so it cannot be asked directly.
 *
 * @param cli - The CLI under test.
 * @param cwd - Where to probe.
 * @param args - The step's arguments; the first non-flag is the command.
 * @returns True when the help page lists the command.
 */
async function hasCommand(
	cli: InstalledCli,
	cwd: string,
	args: readonly string[],
): Promise<boolean> {
	const name = args.find((a) => !a.startsWith("-"));
	if (name === undefined) return true;
	let known = commandCache.get(cli.binPath);
	if (known === undefined) {
		const help = (await cli.run(["--help"], cwd)).stdout;
		const list = help.slice(help.indexOf("Commands:"));
		known = new Set([...list.matchAll(/^ {2}([a-z][\w-]*)/gm)].map((m) => m[1] ?? ""));
		commandCache.set(cli.binPath, known);
	}
	return known.has(name);
}

/** Narrows a step to an edit. */
function isEdit(step: CorpusStep): step is Extract<CorpusStep, { edit: string }> {
	return "edit" in step;
}

/**
 * The agent-facing output of a finished case.
 *
 * @param repo - Repository root.
 * @param outputs - Each command's output.
 * @param alsoScan - Extra files the case names.
 * @returns Named surfaces.
 */
async function collectSurfaces(
	repo: string,
	outputs: readonly StepOutput[],
	alsoScan: readonly string[],
): Promise<Surface[]> {
	const session = path.join(repo, ".session");
	const surfaces: Surface[] = [
		{ name: "NEXT_PROMPT.md", text: await readOr(path.join(session, "NEXT_PROMPT.md")) },
		{
			name: "CLAUDE.md (managed block)",
			text: managedBlock(await readOr(path.join(repo, "CLAUDE.md"))),
		},
		{
			name: "SESSION_STATE.md notes",
			text: stateNotes(await readOr(path.join(session, "SESSION_STATE.md"))),
		},
		...outputs.map((o) => ({ name: o.label, text: `${o.result.stdout}\n${o.result.stderr}` })),
	];
	for (const rel of alsoScan)
		surfaces.push({ name: rel, text: await readOr(path.join(repo, rel)) });
	return surfaces;
}

/** Whether an exit code meets its expectation. */
function exitMatches(expect: ExitExpectation, code: number): boolean {
	return expect === "any" || (expect === "zero" ? code === 0 : code !== 0);
}

/**
 * Failures every case is checked for: timeouts, stack traces, wrong exits.
 *
 * @param outputs - Each command's output.
 * @param timeoutMs - The limit that applied.
 * @returns One message per failure.
 */
function commandFailures(outputs: readonly StepOutput[], timeoutMs: number): string[] {
	const out: string[] = [];
	for (const o of outputs) {
		if (o.result.timedOut === true) {
			out.push(`${o.label}: still running after ${String(timeoutMs)} ms`);
		} else if (!exitMatches(o.expectExit, o.result.exitCode)) {
			out.push(`${o.label}: exit ${String(o.result.exitCode)}, expected ${o.expectExit}`);
		}
		if (STACK_FRAME_RE.test(o.result.stderr) || STACK_FRAME_RE.test(o.result.stdout)) {
			out.push(`${o.label}: printed a stack trace`);
		}
	}
	return out;
}

/**
 * Judges the marker and the prompt.
 *
 * @param c - The case.
 * @param prompt - NEXT_PROMPT.md.
 * @param occurrences - Marker occurrences across every surface.
 * @returns One message per failure.
 */
function contentFailures(
	c: AdversarialCase,
	prompt: string,
	occurrences: readonly Occurrence[],
): string[] {
	const out: string[] = [];
	for (const o of occurrences) {
		if (c.expect === "absent" || !o.attributed) {
			const how = o.attributed ? "present (quoted)" : "unattributed";
			out.push(`marker ${how} in ${o.surface}:${String(o.line)}: ${o.text.trim().slice(0, 160)}`);
		}
	}
	for (const ref of escapingRefs(prompt))
		out.push(`prompt names a path outside the project: ${ref}`);
	const named = new Set(declaredFromPrompt(prompt));
	for (const p of c.mustName ?? []) {
		if (!named.has(p)) out.push(`prompt no longer names ${p}`);
	}
	return out;
}

/**
 * Runs one case and judges it.
 *
 * @param cli - The CLI under test.
 * @param c - The case.
 * @param keep - Leave the workspace on disk.
 * @returns The row.
 */
async function runCase(
	cli: InstalledCli,
	c: AdversarialCase,
	keep: boolean,
): Promise<AdversarialRow> {
	const started = Date.now();
	const ws = await buildWorkspace(c);
	try {
		const { outputs, skipped } = await runSteps(cli, ws.repo, c);
		const surfaces = await collectSurfaces(ws.repo, outputs, c.alsoScan ?? []);
		const marker = c.marker;
		const occurrences =
			marker === undefined ? [] : surfaces.flatMap((s) => scanForMarker(s.name, s.text, marker));
		const prompt = surfaces[0]?.text ?? "";
		const failures = [
			...commandFailures(outputs, c.timeoutMs ?? DEFAULT_TIMEOUT_MS),
			...contentFailures(c, prompt, occurrences),
		];
		return {
			id: c.id,
			classification: c.classification,
			failures,
			occurrences,
			skipped,
			durationMs: Date.now() - started,
		};
	} finally {
		if (keep) process.stdout.write(`  kept: ${ws.root}\n`);
		else await fs.rm(ws.root, { recursive: true, force: true });
	}
}

/**
 * Runs every case in the corpus, printing as it goes.
 *
 * @param cli - The CLI under test.
 * @param corpus - The cases.
 * @param keep - Leave workspaces on disk.
 * @returns One row per case.
 */
export async function runAdversarial(
	cli: InstalledCli,
	corpus: readonly AdversarialCase[],
	keep: boolean,
): Promise<AdversarialRow[]> {
	const rows: AdversarialRow[] = [];
	for (const c of corpus) {
		process.stdout.write(`▸ adversarial / ${c.id} [${c.classification}]\n`);
		const row = await runCase(cli, c, keep);
		const quoted = row.occurrences.filter((o) => o.attributed).length;
		process.stdout.write(
			row.failures.length === 0
				? `  clean · ${String(quoted)} quoted occurrence(s) · ${String(row.durationMs)} ms\n`
				: row.failures.map((f) => `  FAIL ${f}\n`).join(""),
		);
		for (const step of row.skipped) process.stdout.write(`  skipped (not in this CLI): ${step}\n`);
		process.stdout.write("\n");
		rows.push(row);
	}
	return rows;
}
