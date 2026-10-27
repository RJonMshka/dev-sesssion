/**
 * Whether planted repository text reaches agent-facing output only as an
 * attributed quotation (REQ-EVAL-6, LLD-agent-tier.md "REQ-EVAL-6: deltas").
 *
 * `evals/` drives the CLI as a black box and cannot import `packages/`, so the
 * two quoted shapes are restated here and pinned by `__tests__/attribution.test.ts`
 * against captured generator output:
 *
 * - a note: `Quoted from <file>[ § "<heading>"]: "<text>"` (`formatQuotedNote`)
 * - a summary: `quoted: "<text>"` (`QUOTED_LABEL`)
 *
 * Both quote with JSON string escaping, so a marker with no quote, backslash or
 * newline appears verbatim inside the literal. A marker on a quoted line but
 * outside its literals is unattributed. The matcher cannot tell a real
 * attribution from one an attacker wrote out by hand in raw text; a corpus
 * marker is plain text, so its raw copy carries no such prefix.
 *
 * @module
 */

import { declaredFromPrompt } from "./grounding.js";

/** One occurrence of a marker in a scanned surface. */
export interface Occurrence {
	/** Which output it was found in, e.g. `NEXT_PROMPT.md` or `$ symbols src/a.ts`. */
	readonly surface: string;
	/** 1-based line within that surface. */
	readonly line: number;
	/** True when the occurrence lies inside an attributed quotation. */
	readonly attributed: boolean;
	/** The whole line, for the report. */
	readonly text: string;
}

/** A double-quoted JSON string literal, escapes included. */
const JSON_LITERAL_RE = /"(?:[^"\\]|\\.)*"/g;

/** A note line: optional CLI box drawing, optional `Note: `, then the attribution. */
const NOTE_LINE_RE = /^[│|\s]*(?:Note: )?Quoted from /;

/** The summary label and its separating space. */
const SUMMARY_LABEL = "quoted: ";

/** dev-sesssion's managed block in an adapter file. */
const BLOCK_START = "<!-- dev-sesssion:start -->";
const BLOCK_END = "<!-- dev-sesssion:end -->";

/**
 * Character ranges, exclusive of the quotes, of the literals on `line` that an
 * attribution introduces.
 *
 * @param line - One line of output.
 * @returns `[start, end)` ranges of attributed literal bodies.
 */
function attributedSpans(line: string): Array<readonly [number, number]> {
	const isNote = NOTE_LINE_RE.test(line);
	const spans: Array<readonly [number, number]> = [];
	for (const m of line.matchAll(JSON_LITERAL_RE)) {
		const start = m.index;
		const before = line.slice(0, start);
		const introduced =
			before.endsWith(SUMMARY_LABEL) ||
			(isNote && (before.endsWith(": ") || before.endsWith("§ ")));
		if (introduced) spans.push([start + 1, start + m[0].length - 1]);
	}
	return spans;
}

/**
 * Finds every occurrence of `marker` in `text` and says whether each one is
 * attributed.
 *
 * @param surface - Name of the output being scanned, carried into the result.
 * @param text - The output.
 * @param marker - Planted text: no quote, backslash or newline.
 * @returns One entry per occurrence, in order.
 */
export function scanForMarker(surface: string, text: string, marker: string): Occurrence[] {
	const out: Occurrence[] = [];
	const lines = text.split("\n");
	for (const [i, line] of lines.entries()) {
		const spans = attributedSpans(line);
		for (let at = line.indexOf(marker); at !== -1; at = line.indexOf(marker, at + 1)) {
			const end = at + marker.length;
			const attributed = spans.some(([s, e]) => at >= s && end <= e);
			out.push({ surface, line: i + 1, attributed, text: line });
		}
	}
	return out;
}

/**
 * The block dev-sesssion writes into an adapter file. The rest of the file is
 * the owner's, and holds whatever the repository put there.
 *
 * @param adapterFile - Raw adapter file, e.g. CLAUDE.md.
 * @returns The block's content, or `""` when there is none.
 */
export function managedBlock(adapterFile: string): string {
	const start = adapterFile.indexOf(BLOCK_START);
	const end = adapterFile.indexOf(BLOCK_END, start);
	if (start === -1 || end === -1) return "";
	return adapterFile.slice(start + BLOCK_START.length, end);
}

/**
 * The notes in SESSION_STATE.md, decoded from YAML, one per line — the text a
 * prompt renders, so the same matcher applies.
 *
 * @param state - Raw SESSION_STATE.md.
 * @returns Decoded notes joined by newlines, or `""`.
 */
export function stateNotes(state: string): string {
	const lines = state.split("\n");
	const head = lines.indexOf("notes:");
	if (head === -1) return "";
	const notes: string[] = [];
	for (const line of lines.slice(head + 1)) {
		const m = /^\s+- (.*)$/.exec(line);
		if (m?.[1] === undefined) break;
		const value = m[1];
		// The writer emits YAML double-quoted strings, whose escapes JSON shares.
		notes.push(value.startsWith('"') ? (JSON.parse(value) as string) : value);
	}
	return notes.join("\n");
}

/**
 * Prompt references that point outside the project root: absolute, drive-
 * lettered, or with a `..` segment.
 *
 * @param prompt - Raw NEXT_PROMPT.md.
 * @returns The offending references, in prompt order.
 */
export function escapingRefs(prompt: string): string[] {
	return declaredFromPrompt(prompt).filter(
		(ref) => ref.startsWith("/") || /^[A-Za-z]:/.test(ref) || ref.split("/").includes(".."),
	);
}
