/**
 * A chunk's brief: its plan section with the task lines removed
 * (LLD-prompt-context.md, REQ-PCX-1..3).
 *
 * Checkboxes are tracked as tasks. Everything else a section says — its goal,
 * its numbered steps, its file list — is what the agent needs to do the work,
 * and was dropped before this existed.
 *
 * @packageDocumentation
 */

import { parseHeading, parseTaskLine, RULE_RE, type ScannedLine } from "./markdown-utils.js";

/** Longest a brief may be (REQ-PCX-3). */
export const MAX_BRIEF_CHARS = 6_000;

/** The last line of a shortened brief. */
const SHORTENED = "_(shortened — the full section is in the original plan)_";

/**
 * Removes headings that have nothing beneath them before the next heading of
 * the same or shallower depth, or the end (REQ-PCX-2).
 *
 * @param lines - Lines with their fence state.
 * @returns The lines, empty headings dropped.
 */
function dropEmptyHeadings(lines: readonly ScannedLine[]): ScannedLine[] {
	const kept: ScannedLine[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const heading = line.inFence ? undefined : parseHeading(line.trimmed);
		if (heading === undefined) {
			kept.push(line);
			continue;
		}
		let hasContent = false;
		for (let j = i + 1; j < lines.length; j++) {
			const next = lines[j];
			if (next === undefined) break;
			const nextHeading = next.inFence ? undefined : parseHeading(next.trimmed);
			if (nextHeading !== undefined && nextHeading.depth <= heading.depth) break;
			if (nextHeading === undefined && next.trimmed !== "") {
				hasContent = true;
				break;
			}
		}
		if (hasContent) kept.push(line);
	}
	return kept;
}

/**
 * Cuts a brief at a line boundary to fit {@link MAX_BRIEF_CHARS} (REQ-PCX-3).
 *
 * @param text - The brief.
 * @returns The brief, shortened with a closing note when it was too long.
 */
function cap(text: string): string {
	if (text.length <= MAX_BRIEF_CHARS) return text;
	const room = MAX_BRIEF_CHARS - SHORTENED.length - 2;
	const cut = text.lastIndexOf("\n", room);
	const head = text.slice(0, cut > 0 ? cut : room).trimEnd();
	return `${head}\n\n${SHORTENED}`;
}

/**
 * Builds a section's brief.
 *
 * Lines keep their original indentation, so nested lists and fenced blocks
 * read as they did in the plan. A checkbox inside a fence is code and stays.
 *
 * @param lines - The section body, from `scanLines`.
 * @returns The brief, or `undefined` when the section is only tasks.
 */
export function extractBrief(lines: readonly ScannedLine[]): string | undefined {
	const withoutTasks = lines.filter((l) => l.inFence || parseTaskLine(l.trimmed) === undefined);
	const text = dropEmptyHeadings(withoutTasks)
		.map((l) => l.raw.trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	const trimmed = stripEdgeRules(text);
	return trimmed === "" ? undefined : cap(trimmed);
}

/**
 * Drops horizontal rules at either end — the separator a plan draws between
 * sections lands in the section above it (REQ-PCX-2). A rule inside is kept.
 *
 * @param text - The brief, already trimmed.
 * @returns The brief without leading or trailing rules.
 */
function stripEdgeRules(text: string): string {
	const lines = text.split("\n");
	while (lines.length > 0 && RULE_RE.test((lines[0] ?? "").trim())) lines.shift();
	while (lines.length > 0 && RULE_RE.test((lines.at(-1) ?? "").trim())) lines.pop();
	return lines.join("\n").trim();
}
