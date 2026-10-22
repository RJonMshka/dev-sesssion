/**
 * Paths a plan section names outside its task lines (LLD-file-index.md,
 * REQ-IDX-12..15).
 *
 * Plans often carry their own file list — a fenced "Key Files" block, a
 * backticked path in a numbered step — that no checkbox mentions. This reads
 * those, conservatively: plan text is repository content, and a mis-tagged
 * file evicts a correct one from a capped load list.
 *
 * @packageDocumentation
 */

import * as path from "node:path";
import { parseTaskLine, type ScannedLine } from "./markdown-utils.js";

/** Most paths one brace-bearing word may expand to. */
const MAX_EXPANSIONS = 64;

/** A backticked code span's content. */
const CODE_SPAN_RE = /`([^`]+)`/g;

/** A path's last segment: a name, then an extension that starts with a letter. */
const FILE_SEGMENT_RE = /^[^.]+(\.[^.]+)*\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/** Characters that may surround a path in prose without being part of it. */
const TRIM_RE = /^[("'[<]+|[)"'\]>.,;:!]+$/g;

/**
 * Expands brace groups, `a/{b,c}.ts` → `a/b.ts`, `a/c.ts` (REQ-IDX-13).
 *
 * @param word - A word that may contain `{x,y}` groups.
 * @returns At most {@link MAX_EXPANSIONS} expansions, in written order.
 */
function expandBraces(word: string): string[] {
	let results = [word];
	for (;;) {
		const next: string[] = [];
		let expanded = false;
		for (const w of results) {
			const m = /\{([^{}]*)\}/.exec(w);
			if (m === null) {
				next.push(w);
				continue;
			}
			expanded = true;
			for (const alt of (m[1] ?? "").split(",")) {
				if (next.length >= MAX_EXPANSIONS) break;
				next.push(w.slice(0, m.index) + alt + w.slice(m.index + m[0].length));
			}
		}
		results = next.slice(0, MAX_EXPANSIONS);
		if (!expanded) return results;
	}
}

/**
 * Normalizes a candidate word to a repo-relative file path, or rejects it.
 *
 * @param word - One word, already brace-expanded.
 * @returns The path, or `undefined` if the word is not a file path.
 */
function toFilePath(word: string): string | undefined {
	const trimmed = word.replace(TRIM_RE, "");
	if (trimmed === "" || trimmed.includes("\\")) return undefined;
	const norm = path.posix.normalize(trimmed);
	if (path.posix.isAbsolute(norm) || norm === ".." || norm.startsWith("../")) return undefined;
	const last = norm.split("/").pop() ?? "";
	return FILE_SEGMENT_RE.test(last) ? norm : undefined;
}

/**
 * Collects the words on one line that might be paths.
 *
 * Inside a fence every word counts; outside, a code span's words and any bare
 * word containing `/` (REQ-IDX-12). Bare prose words such as `Node.js` do not.
 *
 * @param line - The scanned line.
 * @returns Candidate words, in line order.
 */
function candidateWords(line: ScannedLine): string[] {
	if (line.inFence) return line.trimmed.split(/\s+/);
	const words: string[] = [];
	for (const m of line.trimmed.matchAll(CODE_SPAN_RE)) {
		words.push(...(m[1] ?? "").split(/\s+/));
	}
	const prose = line.trimmed.replace(CODE_SPAN_RE, " ");
	words.push(...prose.split(/\s+/).filter((w) => w.includes("/")));
	return words;
}

/**
 * Extracts the file paths a plan section names outside its task lines.
 *
 * @param lines - The section's body, from `scanLines`.
 * @returns Repo-relative paths, each once, in document order (REQ-IDX-15).
 */
export function extractFileRefs(lines: readonly ScannedLine[]): string[] {
	const found = new Set<string>();
	for (const line of lines) {
		// Tasks carry their own status; a done task must not tag a file here.
		if (!line.inFence && parseTaskLine(line.trimmed) !== undefined) continue;
		for (const word of candidateWords(line)) {
			// A glob names a pattern, not a file (REQ-IDX-14).
			if (word === "" || /[*?]/.test(word)) continue;
			for (const expanded of expandBraces(word)) {
				const file = toFilePath(expanded);
				if (file !== undefined) found.add(file);
			}
		}
	}
	return [...found];
}
