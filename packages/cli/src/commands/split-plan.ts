/**
 * Migration path A: Split an existing PLAN.md into `.session/PLAN_N.md` chunks.
 *
 * Detects boundaries via {@link PlanParser.detectBoundaries}, displays them
 * for confirmation, then writes individual chunk files. All business logic
 * delegates to `@dev-session/core`; this module handles prompts and reporting.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { confirm, log, spinner } from "@clack/prompts";
import type { BoundaryResult, PlanChunk } from "@dev-session/core";
import { PlanParser } from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, CliError, PathValidator } from "@dev-session/security";
import { dryRunWrite } from "../utils/dry-run.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result from splitting a PLAN.md file. */
export interface SplitPlanResult {
	/** The parsed plan chunks that were (or would be) written. */
	readonly chunks: readonly PlanChunk[];
	/** Number of chunk files written (0 in dry-run mode). */
	readonly filesWritten: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Split an existing PLAN.md into individual chunk files.
 *
 * Reads the file, parses boundaries, optionally prompts for confirmation,
 * and writes `PLAN_N.md` files into the session directory.
 *
 * @param planPath - Absolute path to the existing PLAN.md file.
 * @param sessionDir - Validated path to the `.session/` directory.
 * @param options - CLI options controlling interactivity and writes.
 * @returns The split result with chunks and write count.
 * @throws {CliError} If the plan file is unreadable or produces no chunks.
 */
export async function splitPlan(
	planPath: string,
	sessionDir: ValidatedPath,
	options: {
		readonly yes: boolean;
		readonly dryRun: boolean;
		readonly verbose: boolean;
		readonly cwd: string;
	},
): Promise<SplitPlanResult> {
	const s = spinner();

	// --- Read the plan file ---
	let content: string;
	try {
		content = fs.readFileSync(planPath, "utf-8");
	} catch {
		throw new CliError({
			message: `Cannot read plan file: ${path.relative(options.cwd, planPath)}`,
			suggestion: "Ensure the file exists and is readable.",
		});
	}

	// --- Detect boundaries ---
	s.start("Analyzing plan structure...");
	const boundaries = PlanParser.detectBoundaries(content);
	const highConfidence = boundaries.filter((b) => b.confidence >= 1.0);
	s.stop(`Found ${highConfidence.length} chunk boundaries.`);

	if (options.verbose) {
		logBoundaries(boundaries);
	}

	// --- Parse into chunks ---
	const chunks = PlanParser.fromMarkdown(content);

	if (chunks.length === 0) {
		throw new CliError({
			message: "No chunks found in PLAN.md. The file must contain ## headings.",
			suggestion: "Add `## Chunk 1 -- ...` headings to your PLAN.md.",
		});
	}

	log.info(`Detected ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}:`);
	for (const chunk of chunks) {
		const taskCount = chunk.tasks.length;
		log.message(
			`  ${chunk.chunk_id}. ${chunk.title} (${taskCount} task${taskCount === 1 ? "" : "s"})`,
		);
	}

	// --- Confirm unless --yes ---
	if (!options.yes) {
		const proceed = await confirm({
			message: `Split into ${chunks.length} chunk files?`,
		});

		if (proceed !== true) {
			log.warn("Aborted plan splitting.");
			return { chunks: [], filesWritten: 0 };
		}
	}

	// --- Write chunk files ---
	let filesWritten = 0;

	for (const chunk of chunks) {
		const filename = `PLAN_${chunk.chunk_id}.md`;
		const chunkContent = PlanParser.toMarkdown(chunk);

		if (options.dryRun) {
			const fullPath = path.join(sessionDir, filename);
			dryRunWrite(fullPath, chunkContent, options.cwd);
		} else {
			const chunkPath = PathValidator.safeResolvePath(filename, sessionDir);
			AtomicWriter.writeFile(chunkPath, chunkContent);
			filesWritten++;
		}
	}

	if (!options.dryRun) {
		log.success(
			`Split into ${filesWritten} chunk${filesWritten === 1 ? "" : "s"}. Active chunk: PLAN_1.md`,
		);
	}

	return { chunks, filesWritten };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log all detected boundaries with their confidence scores.
 *
 * @param boundaries - The detected boundary results.
 */
function logBoundaries(boundaries: readonly BoundaryResult[]): void {
	if (boundaries.length === 0) {
		log.info("No boundaries detected.");
		return;
	}

	log.info("Detected boundaries:");
	for (const b of boundaries) {
		const conf = b.confidence >= 1.0 ? "high" : b.confidence >= 0.7 ? "medium" : "low";
		log.message(`  Line ${b.lineNumber}: "${b.heading}" (${conf} confidence)`);
	}
}
