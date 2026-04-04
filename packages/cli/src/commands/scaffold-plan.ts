/**
 * Migration path B: Interactive scaffolding when no existing PLAN.md is found.
 *
 * Prompts for project name, goal, and phase details, then generates
 * `PLAN_N.md` chunk files with starter task templates. All file writes
 * go through AtomicWriter for safety.
 *
 * @module
 */

import * as path from "node:path";
import { cancel, isCancel, log, text } from "@clack/prompts";
import type { PlanChunk } from "@dev-session/core";
import { PlanParser } from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, CliError, PathValidator } from "@dev-session/security";
import { dryRunWrite } from "../utils/dry-run.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result from scaffold plan generation. */
export interface ScaffoldPlanResult {
	/** The generated plan chunks. */
	readonly chunks: readonly PlanChunk[];
	/** Number of chunk files written (0 in dry-run mode). */
	readonly filesWritten: number;
	/** The project name entered by the user. */
	readonly projectName: string;
}

/** Phase info collected from the user. */
interface PhaseInput {
	readonly name: string;
	readonly goal: string;
	readonly estSessions: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PHASE_COUNT = 3;
const DEFAULT_EST_SESSIONS = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the interactive plan scaffolding wizard.
 *
 * In `--yes` mode, generates a single phase with defaults.
 *
 * @param sessionDir - Validated path to the `.session/` directory.
 * @param options - CLI options controlling interactivity and writes.
 * @param defaultProjectName - Pre-detected project name (from package.json).
 * @returns The scaffold result with generated chunks and write count.
 * @throws {CliError} If the user cancels the wizard.
 */
export async function scaffoldPlan(
	sessionDir: ValidatedPath,
	options: {
		readonly yes: boolean;
		readonly dryRun: boolean;
		readonly verbose: boolean;
		readonly cwd: string;
	},
	defaultProjectName?: string,
): Promise<ScaffoldPlanResult> {
	let projectName: string;
	let phases: readonly PhaseInput[];

	if (options.yes) {
		// Auto mode: single phase with defaults
		projectName = defaultProjectName ?? path.basename(options.cwd);
		phases = [
			{
				name: "Initial setup",
				goal: "Set up the project foundation",
				estSessions: DEFAULT_EST_SESSIONS,
			},
		];
	} else {
		// Interactive mode
		const nameResult = await text({
			message: "Project name:",
			initialValue: defaultProjectName ?? path.basename(options.cwd),
			validate: (v) => (!v || v.trim().length === 0 ? "Project name is required" : undefined),
		});

		if (isCancel(nameResult)) {
			cancel("Init cancelled.");
			throw new CliError({ message: "Init cancelled by user." });
		}
		projectName = nameResult;

		const phaseCountResult = await text({
			message: "How many phases (chunks)?",
			initialValue: String(DEFAULT_PHASE_COUNT),
			validate: (v) => {
				if (!v) return "Enter a number between 1 and 20";
				const n = Number.parseInt(v, 10);
				if (Number.isNaN(n) || n < 1 || n > 20) {
					return "Enter a number between 1 and 20";
				}
				return undefined;
			},
		});

		if (isCancel(phaseCountResult)) {
			cancel("Init cancelled.");
			throw new CliError({ message: "Init cancelled by user." });
		}
		const phaseCount = Number.parseInt(phaseCountResult as string, 10);

		phases = await collectPhases(phaseCount);
	}

	// --- Generate chunks ---
	const chunks = generateChunks(phases);

	if (options.verbose) {
		log.info(`Generating ${chunks.length} chunk file${chunks.length === 1 ? "" : "s"}:`);
		for (const chunk of chunks) {
			log.message(`  ${chunk.chunk_id}. ${chunk.title} (~${chunk.est_sessions ?? "?"} sessions)`);
		}
	}

	// --- Write chunk files ---
	let filesWritten = 0;

	for (const chunk of chunks) {
		const filename = `PLAN_${chunk.chunk_id}.md`;
		const content = PlanParser.toMarkdown(chunk);

		if (options.dryRun) {
			const fullPath = path.join(sessionDir, filename);
			dryRunWrite(fullPath, content, options.cwd);
		} else {
			const chunkPath = PathValidator.safeResolvePath(filename, sessionDir);
			AtomicWriter.writeFile(chunkPath, content);
			filesWritten++;
		}
	}

	if (!options.dryRun) {
		log.success(`Generated ${filesWritten} chunk file${filesWritten === 1 ? "" : "s"}.`);
	}

	return { chunks, filesWritten, projectName };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect phase details interactively.
 *
 * @param count - Number of phases to collect.
 * @returns Array of phase inputs from the user.
 * @throws {CliError} If the user cancels.
 */
async function collectPhases(count: number): Promise<readonly PhaseInput[]> {
	const phases: PhaseInput[] = [];

	for (let i = 1; i <= count; i++) {
		const nameResult = await text({
			message: `Phase ${i} name:`,
			initialValue: i === 1 ? "Foundation & setup" : "",
			validate: (v) => (!v || v.trim().length === 0 ? "Phase name is required" : undefined),
		});

		if (isCancel(nameResult)) {
			cancel("Init cancelled.");
			throw new CliError({ message: "Init cancelled by user." });
		}

		const goalResult = await text({
			message: `Phase ${i} goal (one sentence):`,
			validate: (v) => (!v || v.trim().length === 0 ? "Goal is required" : undefined),
		});

		if (isCancel(goalResult)) {
			cancel("Init cancelled.");
			throw new CliError({ message: "Init cancelled by user." });
		}

		const sessionsResult = await text({
			message: `Phase ${i} estimated sessions:`,
			initialValue: String(DEFAULT_EST_SESSIONS),
			validate: (v) => {
				if (!v) return "Enter a number between 1 and 50";
				const n = Number.parseInt(v, 10);
				if (Number.isNaN(n) || n < 1 || n > 50) {
					return "Enter a number between 1 and 50";
				}
				return undefined;
			},
		});

		if (isCancel(sessionsResult)) {
			cancel("Init cancelled.");
			throw new CliError({ message: "Init cancelled by user." });
		}

		phases.push({
			name: nameResult as string,
			goal: goalResult as string,
			estSessions: Number.parseInt(sessionsResult as string, 10),
		});
	}

	return phases;
}

/**
 * Convert phase inputs into PlanChunk objects.
 *
 * Phase 1 gets starter tasks; subsequent phases get empty templates.
 *
 * @param phases - The user-provided phase inputs.
 * @returns Array of plan chunks ready for serialization.
 */
function generateChunks(phases: readonly PhaseInput[]): PlanChunk[] {
	return phases.map((phase, idx) => {
		const chunkId = idx + 1;
		const isFirst = idx === 0;

		return {
			chunk_id: chunkId,
			title: `${phase.name}`,
			depends_on: isFirst ? [] : [chunkId - 1],
			est_sessions: phase.estSessions,
			tasks: isFirst
				? [
						{ text: `Set up project structure for: ${phase.goal}`, status: "todo" as const },
						{ text: "Configure tooling and dependencies", status: "todo" as const },
						{ text: "Write initial tests", status: "todo" as const },
					]
				: [{ text: phase.goal, status: "todo" as const }],
		};
	});
}
