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
import type { BootstrapContext } from "./bootstrap-formatter.js";

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
 * Formats the budget status line: the tokens judged against the cap, and the
 * always-loaded cost beside them (LLD-budget.md, REQ-BUD-7).
 *
 * @param budget - The calculated context budget.
 * @returns A compact status string like
 *   "Budget: ~750/4000 tokens [OK] + ~1960 always loaded"; the suffix is
 *   omitted when always-include files cost nothing.
 */
export function formatBudgetLine(budget: ContextBudget): string {
	const status = budget.overBudget ? "OVER" : "OK";
	return `Budget: ~${String(budget.cappedTokens)}/${String(budget.budgetCap)} tokens [${status}]${alwaysLoadedSuffix(budget, " + ")}`;
}

/**
 * Formats the over-budget warning `status` and `health` print — one sentence,
 * so the two cannot drift (REQ-BUD-8).
 *
 * @param budget - An over-budget context budget.
 * @returns The warning text.
 */
export function formatOverBudgetMessage(budget: ContextBudget): string {
	return `Context budget exceeded: ~${String(budget.cappedTokens)} / ${String(budget.budgetCap)} tokens${alwaysLoadedSuffix(budget, ", plus ")} — remove large files or split the chunk`;
}

/**
 * The always-loaded cost as a suffix, or nothing when it is zero.
 *
 * @param budget - The context budget.
 * @param joiner - Text placed before the figure.
 * @returns E.g. " + ~1960 always loaded", or "".
 */
function alwaysLoadedSuffix(budget: ContextBudget, joiner: string): string {
	const always = budget.breakdown.alwaysInclude;
	return always > 0 ? `${joiner}~${String(always)} always loaded` : "";
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
 * Prefix introducing paths the plan names that are not on disk (REQ-NEW-1).
 * Not a file-load prefix: nothing on the line exists to be loaded, so the
 * validator and replay scorer must not read it as one.
 */
export const NEW_FILES_PREFIX = "Not on disk yet:";

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

/**
 * Characters a path may hold to be rendered bare, outside any quotation
 * (REQ-NEW-2, REQ-SYM-8). Anything else is repository text and is quoted or
 * dropped, depending on the line.
 */
export const PATH_SHAPED = /^[A-Za-z0-9._\-+@/]+$/;

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
 * Renders a summary taken from a doc comment as a labelled quotation
 * (REQ-PROV-8, REQ-SYM-7, -9).
 *
 * The layer renderer and the `index --show` / `--file` printers share it, so
 * a summary reads the same wherever an agent meets it.
 *
 * @param summary - The stored or extracted summary.
 * @returns `quoted: "<summary>"`, escaped onto one line.
 */
export function formatQuotedSummary(summary: string): string {
	return `${QUOTED_LABEL} ${quoteText(summary)}`;
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

/** Prefix of every note line in a generated prompt. */
export const NOTE_PREFIX = "Note:";

/** Opens a note quoted from a repository file (REQ-PROV-1). */
export const QUOTED_NOTE_PREFIX = "Quoted from ";

/** Opens a note the Claude adapter lifts from `.claude/MEMORY.md`. */
export const MEMORY_NOTE_PREFIX = "[memory] ";

/** The two whole-note shapes 2.4.x wrote to record progress (REQ-WF-3). */
const PROGRESS_NOTE_RES: readonly RegExp[] = [
	/^Session initialized on \d{4}-\d{2}-\d{2}$/,
	/^Completed: Chunks [\d., -]+\. See DONE_LOG\.md for details\.$/,
];

/**
 * Whether a note is in a shape the tool wrote to record progress (REQ-WF-3).
 * The match is on the whole note, so an owner's note that merely starts
 * `Completed:` is not one.
 *
 * @param note - A note from `SESSION_STATE.md`.
 * @returns True for `Session initialized on <date>` or `Completed: Chunks <ids>. …`.
 */
export function isProgressNote(note: string): boolean {
	return PROGRESS_NOTE_RES.some((re) => re.test(note));
}

/**
 * Whether a note was derived from a file the agent can read — quoted from a
 * repository file, or lifted from memory (REQ-WF-2).
 *
 * @param note - A note from `SESSION_STATE.md`.
 * @returns True when the note starts with {@link QUOTED_NOTE_PREFIX} or {@link MEMORY_NOTE_PREFIX}.
 */
export function isDerivedNote(note: string): boolean {
	return note.startsWith(QUOTED_NOTE_PREFIX) || note.startsWith(MEMORY_NOTE_PREFIX);
}

/**
 * The notes a prompt shows (REQ-WF-1..3): progress notes dropped, the owner's
 * notes ahead of derived ones, and within each group the newest first.
 * Notes are stored in the order added, so newest is last.
 *
 * @param notes - Notes in the order they were added.
 * @param max - How many to return at most.
 * @returns Up to `max` notes, in the order to show them.
 */
export function selectNotes(notes: readonly string[], max: number): string[] {
	const newestFirst = notes.filter((n) => !isProgressNote(n)).reverse();
	const owner = newestFirst.filter((n) => !isDerivedNote(n));
	const derived = newestFirst.filter(isDerivedNote);
	return [...owner, ...derived].slice(0, Math.max(0, max));
}

/** Opens the pending-task header: `Next (task 3 of 8):` (REQ-WF-12). */
export const NEXT_PREFIX = "Next";

/** Opens the line saying when the chunk is done (REQ-WF-14). */
export const DONE_WHEN_PREFIX = "Done when:";

/** Opens the line shown once every task is done (REQ-WF-15). */
export const CHUNK_DONE_PREFIX = "Chunk done:";

/** Opens the owner's per-task steps (REQ-WF-16). */
export const WORKFLOW_PREFIX = "Each task:";

/**
 * Pending tasks in the order the prompt lists them (REQ-WF-13): the current
 * task first — the first in-progress task in plan order, else the first todo
 * — then the rest in plan order.
 *
 * @param chunk - The active chunk.
 * @returns The pending tasks, current first; empty when none are pending.
 */
export function orderPendingTasks(chunk: PlanChunk): readonly Task[] {
	const pending = getPendingTasks(chunk);
	const current = pending.find((t) => t.status === "in-progress") ?? pending[0];
	if (current === undefined) return [];
	return [current, ...pending.filter((t) => t !== current)];
}

/** What the tail shows; `formatWorkLines` shrinks it to fit the line cap. */
interface WorkLayout {
	readonly pending: readonly Task[];
	shown: number;
	notes: readonly string[];
	more: boolean;
	workflow: boolean;
}

/** `all 3 tasks are done`, or `the 1 task is done`. */
function allDone(n: number): string {
	return n === 1 ? "the 1 task is done" : `all ${String(n)} tasks are done`;
}

/**
 * Renders the tail for a chunk with pending tasks.
 *
 * @param context - The bootstrap context.
 * @param layout - What to show.
 * @returns The tail lines.
 */
function renderWork(context: BootstrapContext, layout: WorkLayout): string[] {
	const { tasks } = context.chunk;
	const current = layout.pending[0] as Task;
	const hidden = layout.pending.length - layout.shown;
	const steps = layout.workflow ? (context.workflow ?? []) : [];
	const left = tasks.filter((t) => t.status !== "done").length;
	return [
		`${NEXT_PREFIX} (task ${String(tasks.indexOf(current) + 1)} of ${String(tasks.length)}):`,
		...layout.pending
			.slice(0, layout.shown)
			.map((t) => `  ${t.status === "in-progress" ? "[WIP]" : "[ ]"} ${t.text}`),
		...(hidden > 0 && layout.more ? [`  (+${String(hidden)} more tasks)`] : []),
		...(steps.length > 0
			? [`${WORKFLOW_PREFIX} ${steps.map((s, i) => `${String(i + 1)}. ${s}`).join(" ")}`]
			: []),
		`${DONE_WHEN_PREFIX} ${allDone(tasks.length)} (${String(left)} left) — then stop.`,
		...layout.notes.map((n) => `${NOTE_PREFIX} ${n}`),
	];
}

/**
 * The prompt's tail, after the `Resume` lines: the position and pending
 * tasks, the owner's workflow, the exit line, and notes (REQ-WF-12..17).
 * Every shipped formatter renders its tail here (REQ-WF-20).
 *
 * When the tail would push the prompt past its line cap, it drops tasks after
 * the current one (counted into `+N more`), then the last shown notes, then
 * the `+N more` line, then the workflow line (REQ-WF-19). What still does not
 * fit is left to {@link trimToMaxLines}.
 *
 * @param context - The bootstrap context.
 * @param linesUsed - Lines the formatter has already written.
 * @param maxTasks - Most pending tasks to list.
 * @param maxNotes - Most notes to show.
 * @returns The tail lines.
 */
export function formatWorkLines(
	context: BootstrapContext,
	linesUsed: number,
	maxTasks: number = DEFAULT_MAX_NEXT_TASKS,
	maxNotes: number = DEFAULT_MAX_NOTES,
): string[] {
	const room = (context.maxPromptLines ?? DEFAULT_MAX_PROMPT_LINES) - linesUsed;
	const pending = orderPendingTasks(context.chunk);
	const notes = selectNotes(context.state.notes, maxNotes);
	if (pending.length === 0) {
		const n = context.chunk.tasks.length;
		const head =
			n > 0
				? [`${CHUNK_DONE_PREFIX} ${allDone(n)} — the next step is \`dev-sesssion advance\`.`]
				: [];
		const kept = notes.slice(0, Math.max(0, room - head.length));
		return [...head, ...kept.map((note) => `${NOTE_PREFIX} ${note}`)];
	}
	const layout: WorkLayout = {
		pending,
		shown: Math.max(1, Math.min(maxTasks, pending.length)),
		notes,
		more: true,
		workflow: true,
	};
	const over = (): boolean => renderWork(context, layout).length > room;
	while (over() && layout.shown > 1) layout.shown--;
	while (over() && layout.notes.length > 0) layout.notes = layout.notes.slice(0, -1);
	if (over()) layout.more = false;
	if (over()) layout.workflow = false;
	return renderWork(context, layout);
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
			s === undefined
				? `${QUOTED_NOTE_PREFIX}${sourceFile}`
				: `${QUOTED_NOTE_PREFIX}${sourceFile} § ${quoteText(s)}`;
		return t.length === 0 ? head : `${head}: ${quoteText(t)}`;
	};

	const body = fitText(text, (t) => render(section, t), MAX_NOTE_CHARS);
	if (body !== null) return render(section, body);

	const placeholder = text.length === 0 ? "" : ELLIPSIS;
	const heading =
		section === undefined ? null : fitText(section, (s) => render(s, placeholder), MAX_NOTE_CHARS);
	if (heading !== null) return render(heading, placeholder);
	return `${QUOTED_NOTE_PREFIX}${sourceFile}`.slice(0, MAX_NOTE_CHARS);
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
 * The `Not on disk yet:` line (LLD-new-files.md, REQ-NEW-1). Paths are plain
 * text, not passed through a formatter's `ref`: an `@path` to a missing file
 * is an error in the tool that reads it.
 *
 * @param paths - Path-shaped absent paths, from `NewFiles.absent`.
 * @returns The line, or `undefined` when there are none.
 */
export function formatNewFilesLine(paths: readonly string[] | undefined): string | undefined {
	if (paths === undefined || paths.length === 0) return undefined;
	return `${NEW_FILES_PREFIX} ${formatRefList(paths)}`;
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
