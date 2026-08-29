/**
 * The heading plan source — splits a document on whichever heading depth
 * carries its chunks.
 *
 * Supersedes the fixed `## `-only rule in `plan-parser.ts`. The depth is chosen
 * from a census of the document rather than assumed, so plans written in h1 or
 * h3, and plans whose sections are called Phase or Step rather than Chunk, are
 * parsed instead of yielding nothing.
 *
 * @packageDocumentation
 */

import type { PlanChunk, Task } from "../../schemas/index.js";
import {
	buildDependsPattern,
	isRepresentableChunkId,
	parseDeclaredPosition,
	parseDependencies,
	parseEstSessions,
	parseHeading,
	parseTaskLine,
	scanLines,
} from "./markdown-utils.js";
import type { ExcludedSection, PlanParseResult, PlanSource, PlanSourceDetection } from "./types.js";

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

/** A heading section, with the lines that belong to it. */
interface Section {
	readonly heading: string;
	readonly line: number;
	readonly bodyLines: readonly string[];
	readonly declaredValue: number | undefined;
	readonly declaredTitle: string | undefined;
	/**
	 * `false` for a section opened by a heading shallower than the split depth.
	 * Such a section is never a chunk; it is tracked only so work sitting under
	 * it can be reported rather than silently dropped.
	 */
	readonly atSplitDepth: boolean;
}

/** Per-depth heading counts used to choose the split depth. */
interface DepthCensus {
	/** Total headings seen at this depth. */
	count: number;
	/** How many of them declare a position. */
	declaring: number;
}

// ---------------------------------------------------------------------------
// Depth selection
// ---------------------------------------------------------------------------

/**
 * Census the document's headings by depth, skipping fenced code blocks.
 *
 * @param content - The raw plan document.
 * @returns A map from heading depth to its counts.
 */
function censusDepths(content: string): Map<number, DepthCensus> {
	const census = new Map<number, DepthCensus>();

	for (const line of scanLines(content)) {
		if (line.inFence) {
			continue;
		}
		const heading = parseHeading(line.trimmed);
		if (heading === undefined) {
			continue;
		}

		const entry = census.get(heading.depth) ?? { count: 0, declaring: 0 };
		entry.count++;
		if (parseDeclaredPosition(heading.text) !== undefined) {
			entry.declaring++;
		}
		census.set(heading.depth, entry);
	}

	return census;
}

/**
 * Choose the heading depth that carries the document's chunks.
 *
 * Where any depth has position-declaring headings, the depth with the most of
 * them wins, ties going to the shallowest (REQ-PS-4). Otherwise the shallowest
 * depth occurring more than once wins, falling back to the shallowest depth
 * present (REQ-PS-5).
 *
 * The declaring-count rule comes first because `### Tasks` repeated under every
 * chunk outnumbers the chunk headings themselves in most real plans, and
 * because a document's first two lines are often both h1.
 *
 * @param census - The per-depth counts from {@link censusDepths}.
 * @returns The chosen depth, or `undefined` if the document has no headings.
 */
function chooseSplitDepth(census: Map<number, DepthCensus>): number | undefined {
	const depths = [...census.keys()].sort((a, b) => a - b);
	if (depths.length === 0) {
		return undefined;
	}

	let best: number | undefined;
	for (const depth of depths) {
		const entry = census.get(depth);
		if (entry === undefined || entry.declaring === 0) {
			continue;
		}
		// Ascending iteration means a strict `>` keeps the shallowest on a tie.
		if (best === undefined || entry.declaring > (census.get(best)?.declaring ?? 0)) {
			best = depth;
		}
	}
	if (best !== undefined) {
		return best;
	}

	return depths.find((depth) => (census.get(depth)?.count ?? 0) > 1) ?? depths[0];
}

// ---------------------------------------------------------------------------
// Sectioning
// ---------------------------------------------------------------------------

/**
 * Split a document into sections at the given heading depth.
 *
 * A heading *shallower* than the split depth is a parent heading: it closes the
 * open section rather than extending it. Without that rule, an `## Notes` after
 * a run of `###` chunks has its tasks silently appended to the last chunk —
 * mis-attribution of exactly the kind REQ-IDX-3 fixed for `FILE_INDEX.md`.
 * Deeper headings are children and stay inside their section.
 *
 * Content before the first section heading is discarded, as it is document
 * scaffolding rather than plan content.
 *
 * @param content - The raw plan document.
 * @param splitDepth - The heading depth that opens a section.
 * @returns The sections, in document order.
 */
function collectSections(content: string, splitDepth: number): Section[] {
	const sections: Section[] = [];
	let heading: string | undefined;
	let headingLine = 0;
	let atSplitDepth = false;
	let body: string[] = [];

	const flush = (): void => {
		if (heading === undefined) {
			return;
		}
		const declared = parseDeclaredPosition(heading);
		sections.push({
			heading,
			line: headingLine,
			bodyLines: body,
			declaredValue: declared?.value,
			declaredTitle: declared?.title,
			atSplitDepth,
		});
		heading = undefined;
		body = [];
	};

	for (const line of scanLines(content)) {
		const parsed = line.inFence ? undefined : parseHeading(line.trimmed);

		if (parsed !== undefined && parsed.depth <= splitDepth) {
			flush();
			heading = parsed.text;
			headingLine = line.lineNumber;
			atSplitDepth = parsed.depth === splitDepth;
			continue;
		}

		if (heading !== undefined) {
			body.push(line.trimmed);
		}
	}

	flush();
	return sections;
}

/**
 * Read a section's body for tasks, dependencies, and its session estimate.
 *
 * @param section - The section to read.
 * @param dependsPattern - The document's dependency matcher.
 * @returns The section's tasks, declared dependencies, and estimate.
 */
function readBody(
	section: Section,
	dependsPattern: RegExp,
): { tasks: Task[]; dependsOn: number[]; estSessions: number | undefined } {
	const tasks: Task[] = [];
	let dependsOn: number[] = [];
	let estSessions: number | undefined;

	for (const line of section.bodyLines) {
		const task = parseTaskLine(line);
		if (task !== undefined) {
			tasks.push(task);
			continue;
		}

		if (dependsOn.length === 0) {
			const deps = parseDependencies(line, dependsPattern);
			if (deps.length > 0) {
				dependsOn = deps;
			}
		}

		estSessions ??= parseEstSessions(line);
	}

	return { tasks, dependsOn, estSessions };
}

/**
 * Count the task checkboxes in a section, for exclusion reporting.
 *
 * @param section - The section to count.
 * @returns The number of task lines it contains.
 */
function countTasks(section: Section): number {
	return section.bodyLines.filter((line) => parseTaskLine(line) !== undefined).length;
}

/**
 * Report parent-heading sections that hold work.
 *
 * A heading shallower than the split depth is never a chunk. It is reported
 * only when it carries tasks, which is what separates a document title
 * (`# Roadmap`) from a section whose work would otherwise vanish.
 *
 * @param allSections - Every section, including parent headings.
 * @returns Exclusions for the parent sections that carry tasks.
 */
function collectParentExclusions(allSections: readonly Section[]): ExcludedSection[] {
	const exclusions: ExcludedSection[] = [];

	for (const parent of allSections) {
		if (parent.atSplitDepth) {
			continue;
		}
		const taskCount = countTasks(parent);
		if (taskCount > 0) {
			exclusions.push({
				heading: parent.heading,
				line: parent.line,
				taskCount,
				reason: "no-position-declared",
			});
		}
	}

	return exclusions;
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/**
 * Parse a plan document by splitting it on its dominant heading depth.
 *
 * @param content - The raw plan document.
 * @returns The chunks, the sections excluded from them, and any warnings.
 */
function parse(content: string): PlanParseResult {
	const census = censusDepths(content);
	const splitDepth = chooseSplitDepth(census);
	if (splitDepth === undefined) {
		return { chunks: [], excluded: [], warnings: [] };
	}

	const allSections = collectSections(content, splitDepth);
	const sections = allSections.filter((s) => s.atSplitDepth);
	const declaredMode = sections.some((s) => s.declaredValue !== undefined);

	const nouns = sections
		.map((s) => parseDeclaredPosition(s.heading)?.noun)
		.filter((noun): noun is string => noun !== undefined);
	const dependsPattern = buildDependsPattern(nouns);

	const chunks: PlanChunk[] = [];
	const excluded: ExcludedSection[] = collectParentExclusions(allSections);
	const warnings: string[] = [];
	let ordinal = 0;

	for (const section of sections) {
		if (declaredMode && section.declaredValue === undefined) {
			// Scaffolding such as "## Overview" among "## Chunk N" headings.
			excluded.push({
				heading: section.heading,
				line: section.line,
				taskCount: countTasks(section),
				reason: "no-position-declared",
			});
			continue;
		}

		if (section.declaredValue !== undefined && !isRepresentableChunkId(section.declaredValue)) {
			// A declared id the schema cannot hold, such as "Chunk 0". Excluded
			// rather than renumbered, so the heading means the same thing in
			// every document that contains it.
			excluded.push({
				heading: section.heading,
				line: section.line,
				taskCount: countTasks(section),
				reason: "unrepresentable-id",
			});
			continue;
		}

		ordinal++;
		const { tasks, dependsOn, estSessions } = readBody(section, dependsPattern);
		const base: PlanChunk = {
			chunk_id: section.declaredValue ?? ordinal,
			title: section.declaredTitle ?? section.heading,
			depends_on: dependsOn,
			tasks,
		};
		chunks.push(estSessions === undefined ? base : { ...base, est_sessions: estSessions });
	}

	reportDanglingDependencies(chunks, warnings);
	// Parent-heading exclusions are gathered before the split-depth ones, so
	// sort back into document order for reporting.
	excluded.sort((a, b) => a.line - b.line);
	return { chunks, excluded, warnings };
}

/**
 * Report dependencies naming chunk ids this document does not define.
 *
 * Reported, never removed. A plan split into `PLAN_N.md` files has one chunk
 * per file, so a single-chunk document names ids it cannot contain by
 * construction, and plans legitimately depend on chunks living in a sibling
 * document. The parser cannot distinguish that from a typo, and silently
 * deleting a correct dependency is worse than surfacing a suspicious one.
 *
 * @param chunks - The parsed chunks.
 * @param warnings - Warning sink, appended to in place.
 */
function reportDanglingDependencies(chunks: readonly PlanChunk[], warnings: string[]): void {
	const defined = new Set(chunks.map((c) => c.chunk_id));

	for (const chunk of chunks) {
		const dangling = chunk.depends_on.filter((id) => !defined.has(id));
		if (dangling.length > 0) {
			warnings.push(
				`Chunk ${chunk.chunk_id} ("${chunk.title}") depends on ${dangling.join(", ")}, which this plan does not define.`,
			);
		}
	}
}

/**
 * Score how well this source understands a document.
 *
 * @param content - The raw plan document.
 * @returns The confidence and its reason.
 */
function detect(content: string): PlanSourceDetection {
	const census = censusDepths(content);
	const splitDepth = chooseSplitDepth(census);
	if (splitDepth === undefined) {
		return { confidence: 0, reason: "no headings" };
	}

	const entry = census.get(splitDepth);
	const depthLabel = `h${splitDepth}`;

	if ((entry?.declaring ?? 0) > 0) {
		return {
			confidence: 0.95,
			reason: `${entry?.declaring ?? 0} numbered ${depthLabel} heading(s)`,
		};
	}

	if ((entry?.count ?? 0) > 1) {
		return { confidence: 0.6, reason: `${entry?.count ?? 0} ${depthLabel} headings` };
	}

	const hasTasks = scanLines(content).some(
		(line) => !line.inFence && parseTaskLine(line.trimmed) !== undefined,
	);
	return hasTasks
		? { confidence: 0.4, reason: `single ${depthLabel} heading with tasks` }
		: { confidence: 0, reason: `single ${depthLabel} heading, no tasks` };
}

/**
 * Plan source for heading-structured markdown documents.
 *
 * Handles the original `## Chunk N` dialect plus any heading depth and every
 * position noun in `POSITION_NOUNS`.
 */
export const HeadingPlanSource: PlanSource = {
	name: "headings",
	displayName: "Markdown headings",
	detect,
	parse,
} as const;
