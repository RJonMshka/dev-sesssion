/**
 * Shared utility functions for bootstrap formatters.
 *
 * Pure functions used across all formatter implementations (plain, Claude,
 * opencode, Cursor) to build common prompt sections: completed-chunk
 * summaries, chunk progress, budget status, and pending task lists.
 *
 * @packageDocumentation
 */

import type { ResolvedFileLayer } from "../calculators/layer-resolver.js";
import type { FocusedUnit } from "../calculators/unit-focus.js";
import type { ContextBudget } from "../schemas/context-budget.js";
import type { FileIndexEntry, PlanChunk, SessionState, Task } from "../schemas/index.js";

/** Maximum pending tasks to show in the "Next" section by default. */
export const DEFAULT_MAX_NEXT_TASKS = 4;

/** Maximum notes to include by default. */
export const DEFAULT_MAX_NOTES = 2;

/** Maximum lines in a generated prompt by default. */
export const DEFAULT_MAX_PROMPT_LINES = 20;

/**
 * Summarizes completed chunks as a compact one-liner.
 *
 * @param state - The session state with completed_chunks record.
 * @returns A compact summary string like "Chunks 1-3 done", or empty string if none.
 */
export function formatCompletedChunksSummary(state: SessionState): string {
	const keys = Object.keys(state.completed_chunks)
		.map((k) => Number.parseInt(k, 10))
		.filter((n) => !Number.isNaN(n))
		.sort((a, b) => a - b);

	if (keys.length === 0) {
		return "";
	}

	if (keys.length === 1) {
		return `Chunk ${String(keys[0])} done.`;
	}

	const first = keys[0] as number;
	const last = keys[keys.length - 1] as number;
	const isConsecutive = last - first === keys.length - 1;

	if (isConsecutive) {
		return `Chunks ${String(first)}-${String(last)} done.`;
	}

	return `Chunks ${keys.map(String).join(", ")} done.`;
}

/**
 * Builds the progress line for the active chunk.
 *
 * @param chunk - The active plan chunk.
 * @returns A string like "3/8 tasks done, 1 in-progress".
 */
export function formatChunkProgress(chunk: PlanChunk): string {
	const total = chunk.tasks.length;
	const done = chunk.tasks.filter((t) => t.status === "done").length;
	const inProgress = chunk.tasks.filter((t) => t.status === "in-progress").length;

	const parts: string[] = [`${String(done)}/${String(total)} tasks done`];

	if (inProgress > 0) {
		parts.push(`${String(inProgress)} in-progress`);
	}

	return parts.join(", ");
}

/**
 * Formats the budget status line.
 *
 * @param budget - The calculated context budget.
 * @returns A compact budget status string like "Budget: ~750/4000 tokens [OK]".
 */
export function formatBudgetLine(budget: ContextBudget): string {
	const status = budget.overBudget ? "OVER" : "OK";
	return `Budget: ~${String(budget.totalTokens)}/${String(budget.budgetCap)} tokens [${status}]`;
}

/**
 * Gets pending tasks from a chunk (todo + in-progress).
 *
 * @param chunk - The plan chunk.
 * @returns Array of pending task objects.
 */
export function getPendingTasks(chunk: PlanChunk): readonly Task[] {
	return chunk.tasks.filter((t) => t.status === "todo" || t.status === "in-progress");
}

/**
 * Merges always-include and chunk-tagged entries into one ordered load list.
 *
 * A file may carry both the always-include tag (`0`) and the active chunk's
 * tag, so concatenating the two lists emits it twice. Because the rendered list
 * is capped, a duplicate evicts a real file from the prompt rather than merely
 * looking untidy. Always-include entries are kept first, so existing ordering
 * is unchanged.
 *
 * Single source of truth, deliberately: this merge previously existed as five
 * private copies (the core plain-text formatter and each adapter formatter),
 * which is why the duplicate shipped everywhere at once. Anything building a
 * load list must call this rather than concatenating.
 *
 * @param alwaysIncludeFiles - Entries tagged always-include.
 * @param chunkFiles - Entries tagged to the active chunk.
 * @returns The merged list with later duplicates of the same `filepath` dropped.
 */
export function mergeContextFiles(
	alwaysIncludeFiles: readonly FileIndexEntry[],
	chunkFiles: readonly FileIndexEntry[],
): FileIndexEntry[] {
	const seen = new Set<string>();
	const merged: FileIndexEntry[] = [];
	for (const entry of [...alwaysIncludeFiles, ...chunkFiles]) {
		if (seen.has(entry.filepath)) continue;
		seen.add(entry.filepath);
		merged.push(entry);
	}
	return merged;
}

/** Prefix introducing the flat file-load line. */
export const LOAD_PREFIX = "Load:";

/** Legacy file-load prefix, still accepted when validating older prompts. */
export const LEGACY_LOAD_PREFIX = "Files to load:";

/** Prefix introducing the layered full-source line. */
export const LOAD_FULL_PREFIX = "Load full:";

/** Prefix introducing the layered summary-only line. */
export const SUMMARIES_PREFIX = "Summaries (read_file_layer for detail):";

/**
 * Prefix introducing the active chunk's plan file, which holds its brief
 * (LLD-prompt-context.md, REQ-PCX-5).
 */
export const PLAN_PREFIX = "Plan:";

/**
 * Prefix introducing the focused-units line (REQ-UNIT-13). Each reference is
 * `path#id:start-end`; everything before `#` is the file.
 */
export const FOCUS_PREFIX = "Focus (read_unit):";

/**
 * Every prefix that can introduce file references in a generated prompt.
 *
 * Single source of truth, deliberately: the formatter that writes these lines,
 * the validator that accepts them, and the replay scorer that reads them back
 * each used to carry a private copy, and a prompt could be emitted in a shape
 * its own validator rejected. Anything that emits or parses a file-load line
 * must derive from this list. Ordered most-specific first so a prefix search
 * cannot match a shorter entry by accident.
 */
export const FILE_LOAD_PREFIXES: readonly string[] = [
	LEGACY_LOAD_PREFIX,
	FOCUS_PREFIX,
	LOAD_FULL_PREFIX,
	SUMMARIES_PREFIX,
	PLAN_PREFIX,
	LOAD_PREFIX,
];

/**
 * Suffix the layered summary line appends to each path (e.g. `·L1`).
 */
export const LAYER_SUFFIX_RE = /\u00b7L\d+$/;

/**
 * Longest a note lifted from a repository file may be, attribution included
 * (REQ-PROV-4). A note is one prompt line, and the line cap counts lines, not
 * characters, so without this one note could fill the whole budget.
 */
export const MAX_NOTE_CHARS = 240;

/** Marks a summary the layer renderer quotes from a doc comment (REQ-PROV-2, -8). */
export const QUOTED_LABEL = "quoted:";

/** Appended to text shortened to fit a cap. */
const ELLIPSIS = "…";

/**
 * Renders untrusted text as a one-line, double-quoted literal (REQ-PROV-12).
 *
 * JSON string escaping: `"` and `\` are escaped and line breaks become `\n`,
 * so the quotation stays on one prompt line and only the closing quote the
 * tool adds can end it. Every quotation of repository text goes through here.
 *
 * @param text - Text the tool did not write.
 * @returns The text as a quoted literal.
 */
export function quoteText(text: string): string {
	return JSON.stringify(text);
}

/**
 * Shortens `text` to the longest prefix, plus an ellipsis, whose rendering fits.
 *
 * Truncation happens before quoting, so a cut can never split an escape or
 * drop the closing quote.
 *
 * @param text - The text to shorten.
 * @param render - Renders a candidate; its length is what must fit.
 * @param max - The cap the rendering must not exceed.
 * @returns The text, shortened if needed, or `null` when even an ellipsis does not fit.
 */
function fitText(text: string, render: (t: string) => string, max: number): string | null {
	if (render(text).length <= max) return text;
	const cut = (n: number): string => `${text.slice(0, n)}${ELLIPSIS}`;
	if (render(cut(0)).length > max) return null;
	let lo = 0;
	let hi = text.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (render(cut(mid)).length <= max) lo = mid;
		else hi = mid - 1;
	}
	// End on a word where the last 40% of the kept text has a break, so a note
	// does not stop at "on a mul…" (REQ-RUN-25). A shorter cut still fits.
	const space = text.slice(0, lo + 1).search(/\s\S*$/);
	if (space >= Math.ceil(lo * 0.6)) return `${text.slice(0, space).trimEnd()}${ELLIPSIS}`;
	return cut(lo);
}

/**
 * Renders text lifted from a repository file as an attributed quotation
 * (REQ-PROV-1), capped at {@link MAX_NOTE_CHARS} (REQ-PROV-4).
 *
 * The attribution comes first, so a reader meets it before the quoted text:
 * `Quoted from CLAUDE.md § "Setup step": "Before any task…"`. The section
 * heading is quoted too, because the file wrote it. When the note is too
 * long, the body is shortened first, and the heading only when the
 * attribution alone would not fit.
 *
 * @param opts - The source file, the section within it if any, and the text.
 * @returns One line, at most {@link MAX_NOTE_CHARS} characters.
 */
export function formatQuotedNote(opts: {
	readonly sourceFile: string;
	readonly section?: string;
	readonly text: string;
}): string {
	const { sourceFile, section, text } = opts;
	const render = (s: string | undefined, t: string): string => {
		const head =
			s === undefined ? `Quoted from ${sourceFile}` : `Quoted from ${sourceFile} § ${quoteText(s)}`;
		return t.length === 0 ? head : `${head}: ${quoteText(t)}`;
	};

	const body = fitText(text, (t) => render(section, t), MAX_NOTE_CHARS);
	if (body !== null) return render(section, body);

	const placeholder = text.length === 0 ? "" : ELLIPSIS;
	const heading =
		section === undefined ? null : fitText(section, (s) => render(s, placeholder), MAX_NOTE_CHARS);
	if (heading !== null) return render(heading, placeholder);
	return `Quoted from ${sourceFile}`.slice(0, MAX_NOTE_CHARS);
}

/**
 * Trims a lines array to the maximum allowed line count.
 *
 * Truncation is never silent: when lines are dropped, the final slot is spent
 * on a marker naming the count. The next session is told its bootstrap is
 * incomplete rather than reading a prompt that merely looks whole.
 *
 * @param lines - The full set of prompt lines.
 * @param maxLines - Maximum number of lines to keep.
 * @returns Lines trimmed to the specified cap, ending with a truncation marker
 *   when anything was dropped.
 */
export function trimToMaxLines(lines: readonly string[], maxLines: number): readonly string[] {
	if (lines.length <= maxLines) {
		return lines;
	}
	if (maxLines <= 0) {
		return [];
	}

	const kept = lines.slice(0, maxLines - 1);
	const dropped = lines.length - kept.length;
	return [...kept, `[${String(dropped)} more lines trimmed — see .session/SESSION_STATE.md]`];
}

/**
 * Longest a list of file references may run on one prompt line
 * (LLD-prompt-context.md, REQ-PCX-7): five notes' worth, a tenth of
 * `MAX_PROMPT_CHARS` — about 25 layered refs.
 */
export const MAX_REF_LINE_CHARS = 1_200;

/**
 * Renders a list of file references, naming every one that fits within
 * {@link MAX_REF_LINE_CHARS} and counting the rest as `+N more` (REQ-PCX-7).
 *
 * The one list renderer: every shipped formatter and the prompt writer call it
 * (REQ-PCX-6). A fixed count of six — five copies, plus a sixth at five — used
 * to hide files the budget had already paid for.
 *
 * @param refs - The already-formatted file references.
 * @param maxCount - Optional cap on how many to name, on top of the character cap.
 * @returns A comma-separated string, or `"(none)"` when empty.
 */
export function formatRefList(
	refs: readonly string[],
	maxCount = Number.POSITIVE_INFINITY,
): string {
	if (refs.length === 0) {
		return "(none)";
	}
	const suffixFor = (n: number): string => (n > 0 ? `, +${String(n)} more` : "");
	let shown = 0;
	let length = 0;
	for (const ref of refs) {
		if (shown >= maxCount) break;
		const next = length + (shown === 0 ? 0 : 2) + ref.length;
		if (next + suffixFor(refs.length - shown - 1).length > MAX_REF_LINE_CHARS) break;
		length = next;
		shown++;
	}
	return refs.slice(0, shown).join(", ") + suffixFor(refs.length - shown);
}

/**
 * The `Plan:` line for the active chunk, when it has a brief (REQ-PCX-5).
 *
 * @param chunk - The active chunk.
 * @param ref - Renders a path in the formatter's reference syntax.
 * @returns The line, or `undefined` when there is no brief to point at.
 */
export function formatPlanLine(chunk: PlanChunk, ref: (p: string) => string): string | undefined {
	if (chunk.brief === undefined) return undefined;
	return `${PLAN_PREFIX} ${ref(`.session/PLAN_${String(chunk.chunk_id)}.md`)}`;
}

/**
 * Renders one focused unit as `path#id:start-end`.
 *
 * Deliberately not passed through a formatter's `ref` callback: an
 * `@path#id` mention is not a valid file reference in any supported tool, and
 * the line range lets an agent without `read_unit` do a plain ranged read.
 *
 * @param unit - The focused unit.
 * @returns The rendered reference.
 */
export function formatUnitRef(unit: FocusedUnit): string {
	return `${unit.ref}:${String(unit.start)}-${String(unit.end)}`;
}

/**
 * Builds the layered "Load" section lines from resolved per-file layers.
 *
 * Focused units, when any, come first on a {@link FOCUS_PREFIX} line — they
 * are what the active tasks actually name. Files escalated to layer 2 (full
 * source, referenced by an active task) are listed on a {@link LOAD_FULL_PREFIX}
 * line; the remaining summary-only files (layers 0–1) are listed on a
 * {@link SUMMARIES_PREFIX} line annotated with their layer. The `ref` callback
 * applies the formatter's native file-reference syntax (e.g. an `@`-mention
 * for Claude Code).
 *
 * @param resolved - Per-file resolved layers from `LayerResolver.resolve`.
 * @param ref - Renders a single filepath in the formatter's reference syntax.
 * @param maxFiles - Optional cap on refs per line, on top of the character
 *   cap (REQ-PCX-7). Shipped formatters pass none.
 * @param focus - Units focused by the active tasks (REQ-UNIT-13).
 * @returns The prompt lines describing what to load and at which granularity.
 */
export function formatLayeredContextLines(
	resolved: readonly ResolvedFileLayer[],
	ref: (filepath: string) => string,
	maxFiles: number = Number.POSITIVE_INFINITY,
	focus: readonly FocusedUnit[] = [],
): readonly string[] {
	const full: string[] = [];
	const summary: string[] = [];
	for (const r of resolved) {
		if (r.layer === 2) {
			full.push(ref(r.filepath));
		} else {
			summary.push(`${ref(r.filepath)}·L${String(r.layer)}`);
		}
	}

	const lines: string[] = [];
	if (focus.length > 0) {
		lines.push(`${FOCUS_PREFIX} ${formatRefList(focus.map(formatUnitRef), maxFiles)}`);
	}
	if (full.length > 0) {
		lines.push(`${LOAD_FULL_PREFIX} ${formatRefList(full, maxFiles)}`);
	}
	if (summary.length > 0) {
		lines.push(`${SUMMARIES_PREFIX} ${formatRefList(summary, maxFiles)}`);
	}
	if (lines.length === 0) {
		lines.push(`${LOAD_PREFIX} (none)`);
	}
	return lines;
}
