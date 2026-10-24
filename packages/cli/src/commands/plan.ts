/**
 * `dev-sesssion plan check <file>` (LLD-plan-authoring.md, REQ-PLA-1..6).
 *
 * Reports whether `init` would read a plan, and how, without touching
 * `.session/`. The checking lives in `checkPlan` in core; this module reads the
 * file and renders the report.
 *
 * @module
 */

import * as fs from "node:fs";
import { log } from "@clack/prompts";
import { checkPlan, describeExclusion, type PlanCheckReport } from "@dev-session/core";
import { CliError, PathValidator } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

/** Options for {@link runPlanCheck}. */
export interface PlanCheckOptions {
	/** The plan file, relative to `cwd`. */
	readonly file: string;
	/** The project root. */
	readonly cwd: string;
	/** Print the report as one JSON document. */
	readonly json: boolean;
}

/**
 * Reads the plan file inside the project root.
 *
 * @param file - Path relative to `cwd`.
 * @param cwd - The project root.
 * @returns The file's contents.
 * @throws {SecurityError} If the path escapes the project root.
 * @throws {CliError} If the file cannot be read.
 */
function readPlanFile(file: string, cwd: string): string {
	const resolved = PathValidator.safeResolvePath(file, cwd);
	try {
		return fs.readFileSync(resolved, "utf-8");
	} catch {
		throw new CliError({
			message: `Cannot read plan file: ${file}`,
			suggestion: "Pass a path relative to the project root.",
		});
	}
}

/**
 * Renders the report for a person.
 *
 * @param report - The plan check report.
 */
function renderReport(report: PlanCheckReport): void {
	const scores = report.candidates
		.map((c) => `${c.name} ${c.confidence.toFixed(2)} (${c.reason})`)
		.join(", ");
	if (report.source === null) {
		log.error(`No plan format recognized this document. Tried: ${scores}`);
		log.info("Give each unit of work a `## Chunk N — <title>` heading with `- [ ]` tasks beneath.");
		return;
	}

	log.info(
		`Read as ${report.source.name} (${report.source.confidence.toFixed(2)}). Scores: ${scores}`,
	);
	for (const c of report.chunks) {
		const brief = c.hasBrief ? "" : ", no goal or steps";
		const files = c.namedPaths.length > 0 ? ` — ${c.namedPaths.join(", ")}` : "";
		log.message(
			`  ${c.id}. ${c.title} (${c.taskCount} task${c.taskCount === 1 ? "" : "s"}${brief})${files}`,
		);
	}
	for (const e of report.excluded) {
		const line = `Skipped "${e.heading}" (line ${e.line}, ${e.taskCount} task${e.taskCount === 1 ? "" : "s"}) — ${describeExclusion(e.reason)}`;
		if (e.taskCount > 0) log.warn(line);
		else log.message(`  ${line}`);
	}
	for (const w of report.warnings) log.warn(w);

	if (report.chunks.length === 0) log.error("The plan yields no chunks.");
	else if (report.ok)
		log.success(
			`${report.chunks.length} chunk${report.chunks.length === 1 ? "" : "s"}; init will read this plan.`,
		);
	else log.error("init would drop the tasks above. Give each of those sections a chunk number.");
}

/**
 * Checks a plan file and prints the report.
 *
 * @param options - File, project root and output mode.
 * @returns True when the plan is ok (REQ-PLA-4).
 * @throws {SecurityError} If the path escapes the project root.
 * @throws {CliError} If the file cannot be read.
 */
export function runPlanCheck(options: PlanCheckOptions): boolean {
	const report = checkPlan(readPlanFile(options.file, options.cwd));
	if (options.json) {
		// REQ-PLA-5 — one JSON document on stdout, nothing else.
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		renderReport(report);
	}
	return report.ok;
}

/**
 * Register the `plan` command and its `check` subcommand.
 *
 * @param program - The root Commander program
 */
export function registerPlanCommand(program: Command): void {
	const plan = program.command("plan").description("Work with plan documents");

	plan
		.command("check <file>")
		.description("Report whether init would read a plan, without writing anything")
		.option("--json", "Output machine-readable JSON", false)
		.action((file: string, cmdOptions: { json?: boolean }) => {
			const opts = program.opts<{ cwd: string }>();
			try {
				const ok = runPlanCheck({ file, cwd: opts.cwd, json: cmdOptions.json ?? false });
				if (!ok) process.exitCode = 1;
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
