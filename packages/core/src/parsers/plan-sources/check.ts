/**
 * Checking a plan without ingesting it (LLD-plan-authoring.md, REQ-PLA-1..4).
 *
 * An agent that writes a plan needs to know whether it will parse before it
 * runs `init`. This reports what {@link parsePlan} already knows — the source
 * chosen, every candidate's score, the chunks, what was skipped — in one shape,
 * whether the plan is good, weak, or unrecognized.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import { CliError, isParseError, PathValidator } from "@dev-session/security";
import { detectPlanSource, type PlanSourceCandidate, parsePlan } from "./registry.js";
import type { ExcludedSection, ExclusionReason } from "./types.js";

/** One chunk as a plan check reports it (REQ-PLA-2). */
export interface PlanCheckChunk {
	/** The chunk id the plan declared or was assigned. */
	readonly id: number;
	/** The chunk's title. */
	readonly title: string;
	/** How many task checkboxes the chunk holds. */
	readonly taskCount: number;
	/** Whether the section says anything besides its tasks — a goal, steps, files. */
	readonly hasBrief: boolean;
	/** Repository paths the section names outside its tasks. */
	readonly namedPaths: readonly string[];
}

/** A source's score for the document (REQ-PLA-1). */
export interface PlanCheckCandidate {
	/** The source's registered name. */
	readonly name: string;
	/** Its detection confidence, 0..1. */
	readonly confidence: number;
	/** Why it scored what it did. */
	readonly reason: string;
}

/** Everything a plan check reports. */
export interface PlanCheckReport {
	/** True when the plan yields chunks and loses no task (REQ-PLA-4). */
	readonly ok: boolean;
	/** The source selected, or null when none reached the threshold. */
	readonly source: { readonly name: string; readonly confidence: number } | null;
	/** Every registered source's score, highest first. */
	readonly candidates: readonly PlanCheckCandidate[];
	/** The chunks the selected source produced. */
	readonly chunks: readonly PlanCheckChunk[];
	/** Sections recognized but not made into chunks (REQ-PLA-3). */
	readonly excluded: readonly ExcludedSection[];
	/** Parser warnings, e.g. dependencies on chunks the plan does not define. */
	readonly warnings: readonly string[];
}

/**
 * Says why a section was excluded, in words a user can act on (REQ-PS-20).
 *
 * @param reason - The exclusion reason.
 * @returns One sentence.
 */
export function describeExclusion(reason: ExclusionReason): string {
	return reason === "unrepresentable-id"
		? "chunk ids start at 1, so a chunk numbered below 1 cannot be stored."
		: "the heading declares no chunk number.";
}

/**
 * Maps the registry's ranking to plain report entries.
 *
 * @param candidates - The ranked candidates.
 * @returns One entry per source.
 */
function toCandidates(candidates: readonly PlanSourceCandidate[]): PlanCheckCandidate[] {
	return candidates.map((c) => ({
		name: c.source.name,
		confidence: c.detection.confidence,
		reason: c.detection.reason,
	}));
}

/**
 * Checks a plan document the way `init` would read it, without writing anything.
 *
 * @param content - The raw plan document.
 * @returns The report. An unrecognized or empty plan is a report with `ok: false`.
 * @throws Never for plan content; only for unexpected internal errors.
 */
export function checkPlan(content: string): PlanCheckReport {
	let ingest: ReturnType<typeof parsePlan>;
	try {
		ingest = parsePlan(content);
	} catch (error) {
		if (!isParseError(error)) throw error;
		return {
			ok: false,
			source: null,
			candidates: toCandidates(detectPlanSource(content)),
			chunks: [],
			excluded: [],
			warnings: [],
		};
	}

	const { source, result, candidates } = ingest;
	const best = candidates.find((c) => c.source === source);
	const chunks = result.chunks.map((c) => ({
		id: c.chunk_id,
		title: c.title,
		taskCount: c.tasks.length,
		hasBrief: c.brief !== undefined,
		namedPaths: c.files ?? [],
	}));
	const losesWork = result.excluded.some((e) => e.taskCount > 0);

	return {
		ok: chunks.length > 0 && !losesWork,
		source: { name: source.name, confidence: best?.detection.confidence ?? 0 },
		candidates: toCandidates(candidates),
		chunks,
		excluded: result.excluded,
		warnings: result.warnings,
	};
}

/**
 * Checks a plan file inside the project root. Shared by `plan check` and the
 * MCP `check_plan` tool, so both report the same thing (REQ-ORC-4).
 *
 * @param file - Path relative to `projectRoot`. Untrusted.
 * @param projectRoot - The project root.
 * @returns The report, as {@link checkPlan} gives it.
 * @throws {SecurityError} If the path escapes the project root.
 * @throws {CliError} If the file cannot be read.
 */
export function checkPlanFile(file: string, projectRoot: string): PlanCheckReport {
	const resolved = PathValidator.safeResolvePath(file, projectRoot);
	let content: string;
	try {
		content = fs.readFileSync(resolved, "utf-8");
	} catch {
		throw new CliError({
			message: `Cannot read plan file: ${file}`,
			suggestion: "Pass a path relative to the project root.",
		});
	}
	return checkPlan(content);
}
