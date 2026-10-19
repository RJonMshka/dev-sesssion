/**
 * Deterministic checks for code units (LLD-code-units.md, REQ-UNIT-26..28).
 *
 * The harness drives the CLI as a black box and never imports `packages/`,
 * so every contract here is re-implemented from PROTOCOL.md: the ai-index unit
 * rows, the content hash, the Focus line. If the implementation drifts from the
 * spec, these disagree with it — which is the point.
 *
 * @module
 */

import { createHash } from "node:crypto";

/** One unit row read from `ai-index.yaml`. */
export interface IndexUnit {
	readonly path: string;
	readonly id: string;
	readonly start: number;
	readonly end: number;
	readonly hash: string;
	readonly tokens: number;
	readonly exported: boolean;
	readonly kind: string;
}

/** A `path#id:start-end` reference from a Focus line. */
export interface FocusRef {
	readonly path: string;
	readonly id: string;
	readonly start: number;
	readonly end: number;
}

/** The slice of the context manifest the reduction summary reads. */
export interface ManifestSlice {
	readonly totals: { readonly tokens: number; readonly file_tokens: number };
	readonly entries: readonly {
		readonly ref: string;
		readonly granularity: string;
		readonly tokens: number;
		readonly file_tokens: number;
	}[];
}

/** Prefix of the Focus line, per PROTOCOL.md. */
export const FOCUS_PREFIX = "Focus (read_unit):";

/** One Focus reference: path, `#`, id, `:`, start, `-`, end. */
const FOCUS_REF_RE = /^(.+?)#(.+):(\d+)-(\d+)$/;

/**
 * The PROTOCOL.md content hash over a line range.
 *
 * @param source - Full file text.
 * @param start - First line, 1-based.
 * @param end - Last line, 1-based inclusive.
 * @returns First 16 hex characters of the SHA-256 digest.
 */
export function protocolHash(source: string, start: number, end: number): string {
	const text = source
		.split("\n")
		.slice(start - 1, end)
		.join("\n");
	return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * Reads a YAML key that may be JSON-quoted.
 *
 * @param raw - The key text before the colon.
 * @returns The unquoted key.
 */
function readKey(raw: string): string {
	return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
}

/**
 * Splits a `key: value` line at the colon that ends the key.
 *
 * @param line - A trimmed YAML line.
 * @returns The key and the raw value, or null.
 */
function splitLine(line: string): { key: string; value: string } | null {
	const m = /^("(?:[^"\\]|\\.)*"|[^:]+):\s*(.*)$/.exec(line);
	if (m?.[1] === undefined || m[2] === undefined) return null;
	return { key: readKey(m[1]), value: m[2] };
}

/**
 * Reads a scalar value: number, boolean, quoted or bare string.
 *
 * @param raw - The value text.
 * @returns The parsed value.
 */
function readScalar(raw: string): string | number | boolean {
	if (raw === "true" || raw === "false") return raw === "true";
	if (/^-?\d+$/.test(raw)) return Number(raw);
	return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
}

/**
 * Reads every unit row out of `ai-index.yaml`.
 *
 * Indentation is the structure: file paths at 2, `units:` at 4, ids at 6,
 * fields at 8 — the shape PROTOCOL.md specifies and the CLI writes.
 *
 * @param yaml - The ai-index.yaml text.
 * @returns One row per unit, in file order.
 */
export function parseIndexUnits(yaml: string): IndexUnit[] {
	const rows: IndexUnit[] = [];
	let file = "";
	let inUnits = false;
	let current: Record<string, string | number | boolean> | null = null;
	let id = "";
	const flush = (): void => {
		if (current !== null) rows.push({ path: file, id, ...current } as unknown as IndexUnit);
		current = null;
	};
	for (const raw of yaml.split("\n")) {
		const indent = raw.length - raw.trimStart().length;
		const kv = splitLine(raw.trim());
		if (kv === null) continue;
		if (indent <= 6) flush();
		if (indent === 2) [file, inUnits] = [kv.key, false];
		else if (indent === 4) inUnits = kv.key === "units" && kv.value === "";
		else if (indent === 6 && inUnits) [id, current] = [kv.key, {}];
		else if (indent === 8 && current !== null) current[kv.key] = readScalar(kv.value);
	}
	flush();
	return rows;
}

/** Result of {@link checkHashFidelity}. */
export interface HashFidelity {
	readonly checked: number;
	/** `path#id` of every unit whose recomputed hash differs, or whose file is unreadable. */
	readonly mismatches: readonly string[];
}

/**
 * Recomputes every unit's hash from its file and range (REQ-UNIT-26).
 *
 * @param rows - Units from the index.
 * @param readFile - Returns a file's text by repo-relative path, or null.
 * @returns How many were checked and which disagreed.
 */
export function checkHashFidelity(
	rows: readonly IndexUnit[],
	readFile: (path: string) => string | null,
): HashFidelity {
	const mismatches: string[] = [];
	for (const u of rows) {
		const source = readFile(u.path);
		if (source === null || protocolHash(source, u.start, u.end) !== u.hash) {
			mismatches.push(`${u.path}#${u.id}`);
		}
	}
	return { checked: rows.length, mismatches };
}

/**
 * Parses the Focus line of a prompt.
 *
 * @param prompt - NEXT_PROMPT.md text.
 * @returns Every reference, without the `+N more` marker.
 */
export function parseFocusRefs(prompt: string): FocusRef[] {
	const line = prompt
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.startsWith(FOCUS_PREFIX));
	if (line === undefined) return [];
	const refs: FocusRef[] = [];
	for (const part of line.slice(FOCUS_PREFIX.length).split(",")) {
		const m = FOCUS_REF_RE.exec(part.trim());
		if (m?.[1] === undefined || m[2] === undefined) continue;
		refs.push({ path: m[1], id: m[2], start: Number(m[3]), end: Number(m[4]) });
	}
	return refs;
}

/**
 * Lists Focus refs that name no index unit with the same range (REQ-UNIT-27).
 *
 * @param refs - Refs from the prompt.
 * @param rows - Units from the index.
 * @returns `path#id:start-end` for every ungrounded ref.
 */
export function checkFocusGrounding(
	refs: readonly FocusRef[],
	rows: readonly IndexUnit[],
): string[] {
	return refs
		.filter(
			(r) =>
				!rows.some(
					(u) => u.path === r.path && u.id === r.id && u.start === r.start && u.end === r.end,
				),
		)
		.map((r) => `${r.path}#${r.id}:${String(r.start)}-${String(r.end)}`);
}

/** Token reduction for one generated prompt. */
export interface Reduction {
	/** Tokens of every focused unit. */
	readonly unitTokens: number;
	/** Tokens of the whole files those units sit in. */
	readonly unitFileTokens: number;
	/** unitTokens / unitFileTokens; null when nothing was focused. */
	readonly unitRatio: number | null;
	/** Manifest total / whole-file equivalent; null when the manifest is empty. */
	readonly manifestRatio: number | null;
}

/**
 * Summarizes what the manifest loads against loading whole files (REQ-UNIT-28).
 *
 * @param manifest - The context manifest.
 * @returns The reduction figures.
 */
export function summarizeReduction(manifest: ManifestSlice): Reduction {
	const units = manifest.entries.filter((e) => e.granularity === "unit");
	const unitTokens = units.reduce((n, e) => n + e.tokens, 0);
	const unitFileTokens = units.reduce((n, e) => n + e.file_tokens, 0);
	return {
		unitTokens,
		unitFileTokens,
		unitRatio: unitFileTokens > 0 ? unitTokens / unitFileTokens : null,
		manifestRatio:
			manifest.totals.file_tokens > 0 ? manifest.totals.tokens / manifest.totals.file_tokens : null,
	};
}
