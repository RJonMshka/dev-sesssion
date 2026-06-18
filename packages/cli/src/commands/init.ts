/**
 * `dev-sesssion init` command.
 *
 * Orchestrates the full init wizard: detection, migration path selection,
 * plan splitting or scaffolding, FILE_INDEX generation, and final writes.
 *
 * Business logic lives in @dev-session/core -- this module only handles
 * CLI prompts, formatting, and file write orchestration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	cancel,
	confirm,
	intro,
	isCancel,
	log,
	note,
	outro,
	select,
	spinner,
} from "@clack/prompts";
import type { PlanChunk } from "@dev-session/core";
import { ProjectDetector } from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { CliError, PathValidator } from "@dev-session/security";
import type { Command } from "commander";
import { dryRunMkdir } from "../utils/dry-run.js";
import { handleError } from "../utils/error-handler.js";
import { runDetection } from "./detect.js";
import { runFinalWrites } from "./final-writes.js";
import { generateIndex } from "./generate-index.js";
import { scaffoldPlan } from "./scaffold-plan.js";
import { splitPlan } from "./split-plan.js";

/** Options passed from commander to the init action. */
export interface InitOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Skip all prompts and use defaults. */
	readonly yes: boolean;
	/** Log writes without touching the filesystem. */
	readonly dryRun: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Enable strict mode (block on secret detection). */
	readonly strict: boolean;
	/** Explicit adapter override (from --adapter flag). */
	readonly adapter?: string;
	/**
	 * Explicitly enable team mode (auto-applies .gitignore + .gitattributes).
	 * When undefined and not --yes, the wizard prompts for team vs personal.
	 */
	readonly teamMode?: boolean;
	/**
	 * Cap the number of files indexed during FILE_INDEX generation.
	 * When undefined, all discovered files are indexed.
	 */
	readonly maxFiles?: number;
}

/**
 * Execute the init command.
 *
 * Exported so that other commands (e.g. `migrate`) can invoke init
 * programmatically for sub-directories.
 *
 * @param options - Resolved CLI options
 * @throws CliError if the project cannot be initialized
 */
export async function runInit(options: InitOptions): Promise<void> {
	intro("dev-sesssion init");

	const s = spinner();

	// -----------------------------------------------------------------------
	// Phase 1: Detection (automatic, no prompts)
	// -----------------------------------------------------------------------
	s.start("Detecting project...");
	const projectInfo = ProjectDetector.detect(options.cwd);
	s.stop("Project detected.");

	const detection = runDetection(options.cwd, projectInfo);

	if (options.verbose) {
		log.info(`Project root: ${options.cwd}`);
		log.info(`Existing session: ${detection.session.exists ? "yes" : "no"}`);
		log.info(`Detected tool: ${detection.toolFiles.detectedTool}`);
		if (detection.packageJson.projectName !== undefined) {
			log.info(`Project name: ${detection.packageJson.projectName}`);
		}
		if (detection.plan.found) {
			log.info(
				`PLAN.md: ${detection.plan.relativePath} (${detection.plan.lineCount} lines, ~${detection.plan.estimatedChunks} chunks)`,
			);
		}
		if (detection.toolFiles.hasClaude) {
			log.info("CLAUDE.md: detected (adapter setup available)");
		}
		if (detection.toolFiles.hasAgents) {
			log.info("AGENTS.md: detected (adapter setup available)");
		}
	}

	// -----------------------------------------------------------------------
	// Phase 1b: Handle existing .session/ directory
	// -----------------------------------------------------------------------
	if (detection.session.exists) {
		if (options.yes) {
			log.warn("Existing .session/ found. Reinitializing in --yes mode.");
		} else {
			const reinit = await confirm({
				message: "A .session/ directory already exists. Reinitialize?",
			});

			if (isCancel(reinit) || !reinit) {
				cancel("Init cancelled.");
				outro("No changes made.");
				return;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Phase 1c: Team vs personal mode selection
	// -----------------------------------------------------------------------
	const teamMode = await resolveTeamMode(options);

	if (teamMode === undefined) {
		cancel("Init cancelled.");
		outro("No changes made.");
		return;
	}

	if (options.verbose) {
		log.info(`Mode: ${teamMode ? "team" : "personal"}`);
	}

	// -----------------------------------------------------------------------
	// Phase 2: Ensure .session/ directory exists
	// -----------------------------------------------------------------------
	const sessionDir = ensureSessionDir(options);

	// -----------------------------------------------------------------------
	// Phase 3: Plan chunks (migration path A or B)
	// -----------------------------------------------------------------------
	let chunks: readonly PlanChunk[];
	let projectName = detection.packageJson.projectName ?? path.basename(options.cwd);

	if (detection.plan.found && detection.plan.relativePath) {
		// Migration path A: split existing PLAN.md
		log.info(
			`Found ${detection.plan.relativePath} (${detection.plan.lineCount} lines, ~${detection.plan.estimatedChunks} chunks)`,
		);

		const planFullPath = path.join(options.cwd, detection.plan.relativePath);
		const result = await splitPlan(planFullPath, sessionDir, options);
		chunks = result.chunks;

		if (chunks.length === 0) {
			// User aborted split — fall back to scaffold
			log.info("Falling back to interactive scaffolding.");
			const scaffoldResult = await scaffoldPlan(sessionDir, options, projectName);
			chunks = scaffoldResult.chunks;
			projectName = scaffoldResult.projectName;
		}
	} else {
		// Migration path B: interactive scaffolding
		log.info("No PLAN.md found. Starting interactive setup.");
		const scaffoldResult = await scaffoldPlan(sessionDir, options, projectName);
		chunks = scaffoldResult.chunks;
		projectName = scaffoldResult.projectName;
	}

	if (chunks.length === 0) {
		throw new CliError({
			message: "No plan chunks were created. Init cannot continue.",
			suggestion: "Re-run with a PLAN.md file or answer the scaffolding prompts.",
		});
	}

	// -----------------------------------------------------------------------
	// Phase 4: FILE_INDEX generation (migration path C)
	// -----------------------------------------------------------------------
	const generateOpts: Parameters<typeof generateIndex>[2] = {
		yes: options.yes,
		dryRun: options.dryRun,
		verbose: options.verbose,
		cwd: options.cwd,
		...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
	};
	const indexResult = await generateIndex(sessionDir, chunks, generateOpts);

	// -----------------------------------------------------------------------
	// Phase 5: Final writes (SESSION_STATE, ROUTINES, NEXT_PROMPT, .gitignore)
	// -----------------------------------------------------------------------
	await runFinalWrites(sessionDir, chunks, indexResult.entries, projectName, {
		...options,
		teamMode,
	});

	// -----------------------------------------------------------------------
	// Summary
	// -----------------------------------------------------------------------
	if (options.dryRun) {
		outro("Dry run complete. No files were written.");
	} else {
		note(
			[
				"1. Paste .session/NEXT_PROMPT.md into your AI chat to begin",
				"2. dev-sesssion status    → task progress + context budget",
				"3. dev-sesssion update    → mark tasks done after each session",
				"4. dev-sesssion advance   → move to the next chunk when done",
			].join("\n"),
			"Next steps",
		);
		outro(
			`Init complete. ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}, ${indexResult.fileCount} indexed file${indexResult.fileCount === 1 ? "" : "s"}.`,
		);
	}
}

/**
 * Resolve whether to run in team mode.
 *
 * Resolution order:
 * 1. `options.teamMode === true` → team mode (from --team flag)
 * 2. `options.yes` → personal mode (default, no prompt)
 * 3. Otherwise → prompt the user
 *
 * @param options - CLI options.
 * @returns true for team mode, false for personal, undefined if cancelled.
 */
async function resolveTeamMode(options: InitOptions): Promise<boolean | undefined> {
	if (options.teamMode === true) {
		return true;
	}
	if (options.yes) {
		return false;
	}

	const result = await select({
		message: "How is this session being used?",
		options: [
			{
				value: "personal",
				label: "Personal",
				hint: "session files are local only",
			},
			{
				value: "team",
				label: "Team",
				hint: "auto-adds .gitignore + .gitattributes for shared repos",
			},
		],
	});

	if (isCancel(result)) {
		return undefined;
	}

	return result === "team";
}

/**
 * Ensure the `.session/` directory exists.
 *
 * @param options - CLI options with cwd and dryRun.
 * @returns A ValidatedPath to the `.session/` directory.
 */
function ensureSessionDir(options: InitOptions): ValidatedPath {
	const sessionDir = path.join(options.cwd, ".session");

	if (options.dryRun) {
		if (!fs.existsSync(sessionDir)) {
			dryRunMkdir(sessionDir, options.cwd);
		}
	} else {
		fs.mkdirSync(sessionDir, { recursive: true });
	}

	return PathValidator.safeResolvePath(".session", options.cwd);
}

/**
 * Register the `init` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerInitCommand(program: Command): void {
	const cmd = program
		.command("init")
		.description("Initialize dev-sesssion in the current project")
		.option("--team", "Enable team mode (auto-applies .gitignore + .gitattributes)", false)
		.option(
			"--max-files <n>",
			"Cap the number of files indexed (useful for large repos)",
			undefined,
		);

	cmd.action(async () => {
		const globalOpts = program.opts<{
			cwd: string;
			yes: boolean;
			dryRun: boolean;
			verbose: boolean;
			strict: boolean;
			adapter?: string;
		}>();

		const cmdOpts = cmd.opts<{ team: boolean; maxFiles?: string }>();
		const maxFiles =
			cmdOpts.maxFiles !== undefined ? Number.parseInt(cmdOpts.maxFiles, 10) : undefined;

		const initOptions: InitOptions = {
			cwd: globalOpts.cwd,
			yes: globalOpts.yes,
			dryRun: globalOpts.dryRun,
			verbose: globalOpts.verbose,
			strict: globalOpts.strict,
			...(globalOpts.adapter !== undefined ? { adapter: globalOpts.adapter } : {}),
			teamMode: cmdOpts.team,
			...(maxFiles !== undefined && !Number.isNaN(maxFiles) ? { maxFiles } : {}),
		};

		try {
			await runInit(initOptions);
		} catch (error: unknown) {
			handleError(error);
		}
	});
}
