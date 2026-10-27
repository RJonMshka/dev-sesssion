/**
 * SymbolQuery — what the ai-index holds for a file or a name, and whether
 * that record still matches the code (LLD-symbols.md, area SYM).
 *
 * Reads the index as recorded and never extracts on demand: the point is to
 * show the data prompts are built from. Each reported file is checked against
 * its recorded hash, so a stale record is shown and marked, not hidden.
 *
 * Which declarations a name would focus is decided by
 * {@link UnitFocusResolver.explain}, the same code the prompt uses, so the two
 * cannot disagree.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import { PathValidator, type ValidatedPath } from "@dev-session/security";
import { type Candidate, isCodeShaped, UnitFocusResolver } from "../calculators/unit-focus.js";
import { formatQuotedSummary, PATH_SHAPED, quoteText } from "../formatters/formatter-utils.js";
import type { AiIndex, FileEntry, SymbolSurface, UnitKind } from "./types.js";
import { contentHash } from "./unit-extractor.js";

/** Whether an index entry still matches its file (REQ-SYM-13..15). */
export type Freshness = "current" | "stale" | "removed" | "unknown";

/** One export of a file, as the index records it. */
export interface SymbolExportRow {
	/** Exported name. */
	readonly name: string;
	/** Declaration header without body. */
	readonly signature: string;
	/** 1-based line number. */
	readonly line: number;
	/** Visibility surface. */
	readonly surface: SymbolSurface;
	/** Summary taken from the doc comment. Repository text. */
	readonly summary: string;
	/** Extra `@ai-*` tags. */
	readonly tags: readonly string[];
}

/** One code unit of a file, as the index records it. */
export interface SymbolUnitRow {
	/** Unit id within the file. */
	readonly id: string;
	/** `path#id`, the reference a prompt and `read_unit` use. */
	readonly ref: string;
	/** Declaration kind. */
	readonly kind: UnitKind;
	/** First line, 1-based inclusive. */
	readonly start: number;
	/** Last line, 1-based inclusive. */
	readonly end: number;
	/** Token cost of the range. */
	readonly tokens: number;
	/** Whether the unit is exported. */
	readonly exported: boolean;
}

/** What `symbols <path>` reports (REQ-SYM-1). */
export interface SymbolFileReport {
	/** Repo-relative path. */
	readonly path: string;
	/** Whether the record matches the file now. */
	readonly freshness: Freshness;
	/** Token cost of the whole file. */
	readonly tokens: number;
	/** Module summary. Repository text. */
	readonly moduleSummary: string;
	/** Exports, by line. */
	readonly exports: readonly SymbolExportRow[];
	/** Units by line; `null` when the index did not record units (REQ-SYM-15). */
	readonly units: readonly SymbolUnitRow[] | null;
}

/** One unit `symbols --name` matched (REQ-SYM-2..4). */
export interface SymbolMatch extends SymbolUnitRow {
	/** Repo-relative path of the declaring file. */
	readonly path: string;
	/** Token cost of the declaring file. */
	readonly fileTokens: number;
	/** Whether the declaring file's record matches it now. */
	readonly freshness: Freshness;
	/** Usage evidence when the name has several declarations, else `null`. */
	readonly evidence: string | null;
	/** Whether a task naming the name in backticks would focus this unit. */
	readonly focusable: boolean;
}

/** What `symbols --name` reports. */
export interface SymbolNameReport {
	/** The name asked about. */
	readonly name: string;
	/** Whether the name counts bare in task prose (REQ-SYM-5). */
	readonly codeShaped: boolean;
	/** Whether the resolver refuses the name (REQ-SYM-4, REQ-UNIT-32). */
	readonly ambiguous: boolean;
	/** Matching units, by path then start. */
	readonly matches: readonly SymbolMatch[];
}

/** Suggestion appended wherever the index is missing or behind. */
const RUN_INDEX = "run dev-sesssion index";

/**
 * Compares one file with its index record.
 *
 * A key that fails path validation is reported `removed`: it cannot be read,
 * and the index row is not trusted to name a real file.
 *
 * @param key - Repo-relative path from the index.
 * @param entry - The file's index entry.
 * @param root - The project root the command runs in.
 * @returns The file's freshness.
 */
function freshnessOf(key: string, entry: FileEntry, root: ValidatedPath): Freshness {
	let abs: ValidatedPath;
	try {
		abs = PathValidator.safeResolvePath(key, root);
	} catch {
		return "removed";
	}
	if (!fs.existsSync(abs)) return "removed";
	if (entry.hash === undefined) return "unknown";
	return contentHash(fs.readFileSync(abs, "utf-8")) === entry.hash ? "current" : "stale";
}

/**
 * Lists a file's recorded units as rows, by line.
 *
 * @param key - Repo-relative path.
 * @param entry - The file's index entry.
 * @returns The rows, or `null` when units were not recorded.
 */
function unitRows(key: string, entry: FileEntry): SymbolUnitRow[] | null {
	if (entry.units === undefined) return null;
	return Object.entries(entry.units)
		.map(([id, u]) => ({
			id,
			ref: `${key}#${id}`,
			kind: u.kind,
			start: u.start,
			end: u.end,
			tokens: u.tokens,
			exported: u.exported,
		}))
		.sort((a, b) => a.start - b.start);
}

/**
 * Renders a path bare when it is path-shaped, quoted otherwise (REQ-SYM-8).
 *
 * @param p - A path, or a `path#id:start-end` reference.
 * @returns The path as it may appear in tool prose.
 */
function renderPath(p: string): string {
	const bare = p.replace(/#.*$/, "");
	return PATH_SHAPED.test(bare) ? p : quoteText(p);
}

/**
 * Formats a token count with thousands separators.
 *
 * @param n - The count.
 * @returns e.g. `1,468`.
 */
function tok(n: number): string {
	return n.toLocaleString("en-US");
}

/**
 * The first line of a file's block, ending with its freshness mark.
 *
 * @param r - The file report.
 * @returns The header line.
 */
function fileHeader(r: SymbolFileReport): string {
	const head = `${renderPath(r.path)} · ${tok(r.tokens)} tokens`;
	switch (r.freshness) {
		case "current":
			return `${head} · current`;
		case "stale":
			return `${head} · STALE — ${RUN_INDEX}`;
		case "removed":
			return `${renderPath(r.path)} · removed since indexing`;
		case "unknown":
			return `${head} · freshness unknown (no hash recorded) — ${RUN_INDEX}`;
	}
}

/**
 * Renders a file report as text lines (REQ-SYM-1, -7, -8, -13..15).
 *
 * @param r - The file report.
 * @returns Lines for a person to read.
 */
function renderFile(r: SymbolFileReport): string[] {
	const lines = [fileHeader(r)];
	if (r.freshness === "removed") return lines;
	if (r.moduleSummary) lines.push(formatQuotedSummary(r.moduleSummary));
	if (r.exports.length > 0) {
		lines.push("Exports");
		for (const e of r.exports) {
			const summary = e.summary ? ` — ${formatQuotedSummary(e.summary)}` : "";
			const priv = e.surface === "private" ? " (private)" : "";
			lines.push(`  L${String(e.line)}  ${e.signature}${priv}${summary}`);
		}
	}
	if (r.units === null) {
		lines.push(`Units: not recorded — ${RUN_INDEX}`);
		return lines;
	}
	lines.push(r.units.length > 0 ? "Units" : "Units: none");
	const width = Math.max(0, ...r.units.map((u) => u.id.length));
	for (const u of r.units) {
		const share = r.tokens > 0 ? `${String(Math.round((u.tokens / r.tokens) * 100))}%` : "—";
		const range = `L${String(u.start)}-${String(u.end)}`;
		const exported = u.exported ? "  exported" : "";
		lines.push(
			`  ${u.id.padEnd(width)}  ${u.kind.padEnd(9)} ${range.padEnd(9)} ${tok(u.tokens).padStart(6)} tok ${share.padStart(4)}${exported}`,
		);
	}
	return lines;
}

/**
 * One line per matched unit.
 *
 * @param m - The match.
 * @param contested - Whether the name has more than one declaration.
 * @returns The line.
 */
function matchLine(m: SymbolMatch, contested: boolean): string {
	const ref = renderPath(`${m.path}#${m.id}:${String(m.start)}-${String(m.end)}`);
	const parts = [ref, m.kind, `${tok(m.tokens)} tok (file ${tok(m.fileTokens)})`];
	if (contested) parts.push(m.evidence ?? "no usage evidence");
	if (m.focusable) parts.push("would focus");
	if (m.freshness === "stale") parts.push(`STALE — ${RUN_INDEX}`);
	if (m.freshness === "removed") parts.push("removed since indexing");
	return `  ${parts.join("  ")}`;
}

/**
 * Renders a name report as text lines (REQ-SYM-2..6).
 *
 * @param r - The name report.
 * @returns Lines for a person to read.
 */
function renderName(r: SymbolNameReport): string[] {
	const name = /^[\w$.#~]+$/.test(r.name) ? r.name : quoteText(r.name);
	if (r.matches.length === 0) return [`${name} — no unit by that name in the index`];
	const declarations = new Set(r.matches.map((m) => `${m.path}#${m.id.replace(/~\d+$/, "")}`));
	const n = declarations.size;
	const lines = [`${name} — ${String(n)} declaration${n === 1 ? "" : "s"}`];
	lines.push(...r.matches.map((m) => matchLine(m, n > 1)));
	if (r.ambiguous) {
		lines.push(
			"Ambiguous: too few or too many declarations have usage evidence, so a task naming it focuses nothing.",
		);
	}
	if (!r.codeShaped) {
		lines.push(`A task must put \`${r.name}\` in backticks for it to be focused.`);
	}
	return lines;
}

/**
 * Builds a match row from a resolver candidate.
 *
 * @param c - The candidate unit.
 * @param facts - Freshness, evidence and focus, decided by the caller.
 * @returns The row.
 */
function toMatch(
	c: Candidate,
	facts: Pick<SymbolMatch, "freshness" | "evidence" | "focusable">,
): SymbolMatch {
	return {
		id: c.id,
		ref: `${c.filepath}#${c.id}`,
		kind: c.unit.kind,
		start: c.unit.start,
		end: c.unit.end,
		tokens: c.unit.tokens,
		exported: c.unit.exported,
		path: c.filepath,
		fileTokens: c.fileTokens,
		...facts,
	};
}

/** Queries over a loaded ai-index. Pure apart from the freshness reads. */
export const SymbolQuery = {
	/**
	 * Reports what the index holds for one file.
	 *
	 * @param index - The loaded ai-index.
	 * @param key - Repo-relative path, relative to `projectRoot`.
	 * @param projectRoot - The project root the command runs in.
	 * @returns The report, or `null` when the index has no entry for the file.
	 */
	file(index: AiIndex, key: string, projectRoot: ValidatedPath): SymbolFileReport | null {
		const entry = index.files[key];
		if (entry === undefined) return null;
		const exports = Object.entries(entry.exports)
			.map(([name, s]) => ({ name, ...s }))
			.sort((a, b) => a.line - b.line);
		return {
			path: key,
			freshness: freshnessOf(key, entry, projectRoot),
			tokens: entry.token_cost,
			moduleSummary: entry.module_summary,
			exports,
			units: unitRows(key, entry),
		};
	},

	/**
	 * Reports every unit a name matches, and what a task naming it would focus.
	 *
	 * @param index - The loaded ai-index.
	 * @param name - The name, exactly as a task would write it.
	 * @param projectRoot - The project root the command runs in.
	 * @returns The report; `matches` is empty when nothing matched.
	 */
	name(index: AiIndex, name: string, projectRoot: ValidatedPath): SymbolNameReport {
		const { groups, chosen } = UnitFocusResolver.explain(index, name);
		const contested = groups.length > 1;
		const fresh = new Map<string, Freshness>();
		const probe = (filepath: string): Freshness => {
			const known = fresh.get(filepath);
			if (known !== undefined) return known;
			const entry = index.files[filepath];
			const f = entry === undefined ? "unknown" : freshnessOf(filepath, entry, projectRoot);
			fresh.set(filepath, f);
			return f;
		};
		const matches = groups.flatMap(({ candidates, evidence }) =>
			candidates.map((c) => {
				const ref = `${c.filepath}#${c.id}`;
				return toMatch(c, {
					freshness: probe(c.filepath),
					evidence: contested ? evidence : null,
					focusable: chosen !== "ambiguous" && chosen.has(ref),
				});
			}),
		);
		matches.sort((a, b) => a.path.localeCompare(b.path) || a.start - b.start);
		return { name, codeShaped: isCodeShaped(name), ambiguous: chosen === "ambiguous", matches };
	},

	/**
	 * Renders a report for a person. Summaries are quoted (REQ-SYM-7) and
	 * paths that are not path-shaped are quoted (REQ-SYM-8).
	 *
	 * @param report - A file or name report.
	 * @returns Text lines.
	 */
	renderText(report: SymbolFileReport | SymbolNameReport): string[] {
		return "matches" in report ? renderName(report) : renderFile(report);
	},
} as const;
