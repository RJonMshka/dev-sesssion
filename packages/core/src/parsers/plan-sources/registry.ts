/**
 * Plan source registry — ranks the registered sources against a document and
 * parses it with the best one.
 *
 * Deliberately shaped like `packages/adapters/src/registry.ts`, which solved
 * the same problem for output formats: built-ins plus runtime registrations,
 * name-keyed lookup, and `CliError` on a duplicate name.
 *
 * @packageDocumentation
 */

import { CliError, ParseError } from "@dev-session/security";
import { HeadingPlanSource } from "./heading-source.js";
import { TaskListPlanSource } from "./task-list-source.js";
import type { PlanParseResult, PlanSource, PlanSourceDetection } from "./types.js";

/** Confidence a source must reach before the registry will select it. */
export const PLAN_SOURCE_MIN_CONFIDENCE = 0.3;

/** Built-ins, in the order they are offered to a document. */
const BUILTIN_SOURCES: readonly PlanSource[] = [HeadingPlanSource, TaskListPlanSource];

const customSources = new Map<string, PlanSource>();

const SOURCE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** A source's score for one document. */
export interface PlanSourceCandidate {
	/** The source that was scored. */
	readonly source: PlanSource;
	/** Its detection result. */
	readonly detection: PlanSourceDetection;
}

/** The outcome of ingesting a plan document. */
export interface PlanIngestResult {
	/** The source that parsed the document. */
	readonly source: PlanSource;
	/** What it produced. */
	readonly result: PlanParseResult;
	/** Every source's score, ranked highest first. */
	readonly candidates: readonly PlanSourceCandidate[];
}

/**
 * Registers a custom plan source under its `name`.
 *
 * Once registered, the source competes in {@link detectPlanSource} and can be
 * selected by {@link parsePlan}. Registration is in-process only — it does not
 * persist across CLI invocations.
 *
 * @param source - The plan source to register.
 * @throws {CliError} If the name is not lowercase kebab-case, or is already
 *   registered (built-in names are reserved).
 */
export function registerPlanSource(source: PlanSource): void {
	const { name } = source;

	if (!SOURCE_NAME_PATTERN.test(name)) {
		throw new CliError({
			message: `Invalid plan source name: "${name}"`,
			suggestion: 'Plan source names must be lowercase kebab-case, e.g. "my-format".',
		});
	}

	if (getPlanSourceByName(name) !== undefined) {
		throw new CliError({
			message: `Plan source "${name}" is already registered`,
			suggestion: "Choose a unique name, or call unregisterPlanSource() first for a custom source.",
		});
	}

	customSources.set(name, source);
}

/**
 * Removes a previously registered custom plan source.
 *
 * Built-in sources cannot be removed.
 *
 * @param name - The name the source was registered under.
 * @returns `true` if a custom source was removed, `false` otherwise.
 */
export function unregisterPlanSource(name: string): boolean {
	return customSources.delete(name);
}

/**
 * Resolves a plan source by name, checking built-ins first.
 *
 * @param name - A plan source name.
 * @returns The matching {@link PlanSource}, or `undefined` if none is registered.
 */
export function getPlanSourceByName(name: string): PlanSource | undefined {
	return BUILTIN_SOURCES.find((s) => s.name === name) ?? customSources.get(name);
}

/**
 * Returns every registered plan source: built-ins first, then custom
 * registrations in registration order.
 *
 * @returns The registered sources.
 */
export function getRegisteredPlanSources(): readonly PlanSource[] {
	return [...BUILTIN_SOURCES, ...customSources.values()];
}

/**
 * Scores every registered source against a document.
 *
 * The sort is stable and the input is in registration order, so sources tied on
 * confidence stay in the order they were registered.
 *
 * @param content - The raw plan document.
 * @returns Every source's score, ranked highest confidence first.
 */
export function detectPlanSource(content: string): readonly PlanSourceCandidate[] {
	return getRegisteredPlanSources()
		.map((source) => ({ source, detection: source.detect(content) }))
		.sort((a, b) => b.detection.confidence - a.detection.confidence);
}

/**
 * Parses a plan document with the highest-scoring registered source.
 *
 * @param content - The raw plan document.
 * @returns The selected source, its parse result, and the full ranking.
 * @throws {ParseError} If the content is empty, or if no source reaches
 *   {@link PLAN_SOURCE_MIN_CONFIDENCE}.
 */
export function parsePlan(content: string): PlanIngestResult {
	if (content.trim().length === 0) {
		throw new ParseError({ message: "Plan content is empty", file: "PLAN.md" });
	}

	const candidates = detectPlanSource(content);
	const best = candidates[0];

	if (best === undefined || best.detection.confidence < PLAN_SOURCE_MIN_CONFIDENCE) {
		throw new ParseError({
			message: `No plan format recognized this document. Tried: ${formatCandidates(candidates)}`,
			file: "PLAN.md",
		});
	}

	return { source: best.source, result: best.source.parse(content), candidates };
}

/**
 * Render candidate sources and their scores for an error or report.
 *
 * @param candidates - The ranked candidates.
 * @returns A one-line summary, e.g. `headings (0.00: no headings)`.
 */
export function formatCandidates(candidates: readonly PlanSourceCandidate[]): string {
	if (candidates.length === 0) {
		return "no plan sources registered";
	}
	return candidates
		.map((c) => `${c.source.name} (${c.detection.confidence.toFixed(2)}: ${c.detection.reason})`)
		.join(", ");
}
