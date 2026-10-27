/**
 * Unit focus — decides which code units the active tasks name
 * (LLD-code-units.md, REQ-UNIT-7..11).
 *
 * A focused unit is loaded on its own instead of escalating its whole file:
 * median 82 tokens against a median file of 1,468 on this repository.
 *
 * Matching is deliberately conservative, because a wrong focus costs a prompt
 * slot and points the agent at the wrong code:
 *
 * - Only code-shaped identifiers count bare — `parseBody`, `TokenStore`,
 *   `MAX_LINES`. A plain word like `validate` counts only in backticks, since in
 *   prose it is usually just a word.
 * - A name declared in more than one place is resolved by proof of use: every
 *   declaration the code certainly uses is focused, with its evidence; one
 *   with no evidence is not. None proven, or too many, focuses nothing.
 * - A qualified `Parent.member` focuses the member alone.
 *
 * @packageDocumentation
 */

import type { AiIndex, UnitEntry } from "../annotation/types.js";
import type { Task } from "../schemas/index.js";

/** Most units a single prompt focuses. One prompt line holds them. */
export const MAX_FOCUS_UNITS = 5;

/** Most declarations of one name focused at once before it counts as ambiguous. */
export const MAX_LIVE_MATCHES = 3;

/** A unit the prompt should load on its own. */
export interface FocusedUnit {
	/** Repo-relative file path. */
	readonly filepath: string;
	/** Unit id within the file (`parseBody`, `TokenStore.refresh`, `pick~2`). */
	readonly id: string;
	/** `filepath#id` — the reference a prompt and `read_unit` use. */
	readonly ref: string;
	/** First line, 1-based inclusive. */
	readonly start: number;
	/** Last line, 1-based inclusive. */
	readonly end: number;
	/** Token cost of the unit. */
	readonly tokens: number;
	/** Token cost of the whole file the unit lives in. */
	readonly fileTokens: number;
	/** Content hash of the unit when indexed. */
	readonly hash: string;
	/** Text of the task whose mention caused the focus. */
	readonly task: string;
	/**
	 * Why this declaration was chosen when its name had several (REQ-UNIT-33),
	 * e.g. `imported by 2 files`. Absent when the name was unique.
	 */
	readonly evidence?: string;
}

/** Inputs for {@link UnitFocusResolver.resolve}. */
export interface UnitFocusInput {
	/** The active chunk's tasks. */
	readonly tasks: readonly Task[];
	/** The loaded ai-index, or `null` when none exists. */
	readonly index: AiIndex | null;
}

/** Result of {@link UnitFocusResolver.resolve}. */
export interface UnitFocusResult {
	/** Units to focus, in first-mention order, capped at {@link MAX_FOCUS_UNITS}. */
	readonly focused: readonly FocusedUnit[];
	/** Names that matched more than one declaration and so focused nothing. */
	readonly ambiguous: readonly string[];
}

/** One unit in the lookup table. */
export interface Candidate {
	readonly filepath: string;
	readonly id: string;
	/** Id without a `~n` repeat suffix — siblings share it. */
	readonly baseId: string;
	readonly unit: UnitEntry;
	readonly fileTokens: number;
}

/** Name → units, built once per resolve. */
interface NameTable {
	/** Keyed by full base id (`parseBody`, `TokenStore.refresh`). */
	readonly byId: ReadonlyMap<string, readonly Candidate[]>;
	/** Keyed by a member's own name (`refresh`), members only. */
	readonly byLeaf: ReadonlyMap<string, readonly Candidate[]>;
	/** `file#baseId` → the other files that provably import it (REQ-UNIT-31). */
	readonly importers: ReadonlyMap<string, ReadonlySet<string>>;
}

/** A backticked span, or a bare (possibly dotted) identifier. */
const MENTION_RE = /`([^`]+)`|([A-Za-z_$][\w$]*(?:\.[A-Za-z_$#][\w$]*)*)/g;

/** What a backticked span must look like, once a trailing call is removed. */
const QUALIFIED_RE = /^[A-Za-z_$#][\w$#]*(?:\.[A-Za-z_$#][\w$#]*)?$/;

/**
 * Whether a bare identifier is shaped like code rather than prose.
 *
 * @param name - The identifier, possibly dotted.
 * @returns `true` for dotted names, inner capitals, `_`, `$` or digits.
 */
export function isCodeShaped(name: string): boolean {
	return name.includes(".") || /.[A-Z]/.test(name) || /[_$\d]/.test(name);
}

/**
 * Lists the names a task mentions that are eligible for lookup, in order.
 *
 * @param text - The task text.
 * @returns Candidate names, first mention first.
 */
function mentions(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(MENTION_RE)) {
		if (m[1] !== undefined) {
			const name = m[1].trim().replace(/\(.*\)$/, "");
			if (QUALIFIED_RE.test(name)) out.push(name);
		} else if (m[2] !== undefined && isCodeShaped(m[2])) {
			out.push(m[2]);
		}
	}
	return out;
}

/**
 * Appends a value to a multimap entry.
 *
 * @param map - The multimap.
 * @param key - The key.
 * @param value - The value to append.
 */
function add(map: Map<string, Candidate[]>, key: string, value: Candidate): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/**
 * Builds the name lookup table from every unit in the index.
 *
 * @param index - The ai-index.
 * @returns Lookup maps by id and by member name.
 */
function buildTable(index: AiIndex): NameTable {
	const byId = new Map<string, Candidate[]>();
	const byLeaf = new Map<string, Candidate[]>();
	for (const [filepath, entry] of Object.entries(index.files)) {
		for (const [id, unit] of Object.entries(entry.units ?? {})) {
			const baseId = id.replace(/~\d+$/, "");
			const c: Candidate = { filepath, id, baseId, unit, fileTokens: entry.token_cost };
			add(byId, baseId, c);
			const dot = baseId.lastIndexOf(".");
			if (dot !== -1) add(byLeaf, baseId.slice(dot + 1), c);
		}
	}
	return { byId, byLeaf, importers: buildImporters(index) };
}

/**
 * Adds an importing file under a `file#id` key.
 *
 * @param map - The importer sets.
 * @param key - `file#id`.
 * @param importer - The importing file.
 */
function addImporter(map: Map<string, Set<string>>, key: string, importer: string): void {
	const set = map.get(key);
	if (set) set.add(importer);
	else map.set(key, new Set([importer]));
}

/**
 * Builds the importer sets from every file's recorded imports.
 *
 * A named import proves its target. A namespace import (`* as ns`) proves a
 * name only together with an `ns.name` access, and an imported parent proves a
 * member only together with a `local.member` access.
 *
 * @param index - The ai-index.
 * @returns `file#id` → importing files.
 */
function buildImporters(index: AiIndex): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>();
	for (const [file, entry] of Object.entries(index.files)) {
		const memberRefs = entry.member_refs ?? [];
		for (const imp of entry.imports ?? []) {
			if (imp.from === file) continue;
			const prefix = `${imp.local}.`;
			const accessed = memberRefs
				.filter((r) => r.startsWith(prefix))
				.map((r) => r.slice(prefix.length));
			if (imp.name === "*") {
				for (const name of accessed) addImporter(map, `${imp.from}#${name}`, file);
				continue;
			}
			addImporter(map, `${imp.from}#${imp.name}`, file);
			for (const member of accessed) addImporter(map, `${imp.from}#${imp.name}.${member}`, file);
		}
	}
	return map;
}

/**
 * States the usage evidence for one declaration, or `null` when it has none.
 *
 * @param table - The lookup table.
 * @param group - Sibling units of one declaration.
 * @returns e.g. `imported by 2 files; referenced 1× in its file`, or `null`.
 */
function evidenceFor(table: NameTable, group: readonly Candidate[]): string | null {
	const first = group[0];
	if (first === undefined) return null;
	const importers = table.importers.get(`${first.filepath}#${first.baseId}`)?.size ?? 0;
	const refs = Math.max(...group.map((c) => c.unit.refs ?? 0));
	const parts: string[] = [];
	if (importers > 0)
		parts.push(`imported by ${String(importers)} file${importers === 1 ? "" : "s"}`);
	if (refs > 0) parts.push(`referenced ${String(refs)}× in its file`);
	return parts.length > 0 ? parts.join("; ") : null;
}

/** The declarations a name resolves to, each with its evidence when contested. */
type Resolution =
	| { readonly group: readonly Candidate[]; readonly evidence?: string }[]
	| "ambiguous";

/**
 * Resolves a name to declarations (REQ-UNIT-30, REQ-UNIT-32).
 *
 * @param table - The lookup table.
 * @param name - A mentioned name.
 * @returns The chosen declarations, `[]` when nothing matched, or `"ambiguous"`.
 */
function choose(table: NameTable, name: string): Resolution {
	const groups = lookup(table, name);
	if (groups.length <= 1) return groups.map((group) => ({ group }));
	const live = groups.flatMap((group) => {
		const evidence = evidenceFor(table, group);
		return evidence === null ? [] : [{ group, evidence }];
	});
	return live.length === 0 || live.length > MAX_LIVE_MATCHES ? "ambiguous" : live;
}

/**
 * Looks a name up, grouping matches by declaration.
 *
 * @param table - The lookup table.
 * @param name - A mentioned name.
 * @returns One group per distinct declaration (file + base id).
 */
function lookup(table: NameTable, name: string): Candidate[][] {
	const hits = [...(table.byId.get(name) ?? [])];
	if (!name.includes(".")) hits.push(...(table.byLeaf.get(name) ?? []));
	const groups = new Map<string, Candidate[]>();
	for (const c of hits) add(groups, `${c.filepath}#${c.baseId}`, c);
	return [...groups.values()];
}

/**
 * Converts a candidate into a focused unit.
 *
 * @param c - The matched unit.
 * @param task - The task that mentioned it.
 * @returns The focused unit.
 */
function toFocused(c: Candidate, task: string, evidence?: string): FocusedUnit {
	return {
		...(evidence !== undefined ? { evidence } : {}),
		filepath: c.filepath,
		id: c.id,
		ref: `${c.filepath}#${c.id}`,
		start: c.unit.start,
		end: c.unit.end,
		tokens: c.unit.tokens,
		fileTokens: c.fileTokens,
		hash: c.unit.hash,
		task,
	};
}

/**
 * Focuses the declarations one mentioned name resolves to, or records it as
 * ambiguous. `resolve` and `explain` both run this, so a name focuses the same
 * units whichever asks.
 *
 * @param table - The lookup table.
 * @param name - A mentioned name.
 * @param task - The task text that mentioned it.
 * @param focused - Focused units so far, by ref; added to.
 * @param ambiguous - Ambiguous names so far; added to.
 */
function focusName(
	table: NameTable,
	name: string,
	task: string,
	focused: Map<string, FocusedUnit>,
	ambiguous: Set<string>,
): void {
	const chosen = choose(table, name);
	if (chosen === "ambiguous") {
		ambiguous.add(name);
		return;
	}
	for (const { group, evidence } of chosen) {
		const siblings = [...group].sort((a, b) => a.unit.start - b.unit.start);
		for (const c of siblings) {
			const unit = toFocused(c, task, evidence);
			if (!focused.has(unit.ref)) focused.set(unit.ref, unit);
		}
	}
}

/** One declaration of a name, as {@link UnitFocusResolver.explain} reports it. */
export interface DeclarationGroup {
	/** Sibling units of the declaration (`pick`, `pick~2`), in source order. */
	readonly candidates: readonly Candidate[];
	/** Usage evidence, or `null` when the code provably uses it nowhere. */
	readonly evidence: string | null;
}

/** Result of {@link UnitFocusResolver.explain}. */
export interface FocusExplanation {
	/** Every declaration the name matches, in lookup order. */
	readonly groups: readonly DeclarationGroup[];
	/** Refs a task naming the name in backticks would focus, or `"ambiguous"`. */
	readonly chosen: ReadonlySet<string> | "ambiguous";
}

/**
 * Resolves the units named by active tasks.
 */
export const UnitFocusResolver = {
	/**
	 * Finds the units the active tasks name.
	 *
	 * @param input - Tasks and the ai-index.
	 * @returns Focused units and the names that were too ambiguous to focus.
	 */
	resolve(input: UnitFocusInput): UnitFocusResult {
		if (input.index === null) return { focused: [], ambiguous: [] };
		const table = buildTable(input.index);
		const focused = new Map<string, FocusedUnit>();
		const ambiguous = new Set<string>();

		for (const task of input.tasks) {
			if (task.status === "done") continue;
			for (const name of mentions(task.text)) {
				focusName(table, name, task.text, focused, ambiguous);
			}
		}

		return {
			focused: [...focused.values()].slice(0, MAX_FOCUS_UNITS),
			ambiguous: [...ambiguous],
		};
	},

	/**
	 * Explains how one name resolves: every declaration it matches, each one's
	 * evidence, and what a single active task naming it in backticks would
	 * focus (REQ-SYM-3, -4). Shares every decision with {@link resolve}.
	 *
	 * @param index - The ai-index.
	 * @param name - The name, as a person would write it between backticks.
	 * @returns The declarations and the focus outcome.
	 */
	explain(index: AiIndex, name: string): FocusExplanation {
		const table = buildTable(index);
		const groups = lookup(table, name).map((group) => ({
			candidates: [...group].sort((a, b) => a.unit.start - b.unit.start),
			evidence: evidenceFor(table, group),
		}));
		const focused = new Map<string, FocusedUnit>();
		const ambiguous = new Set<string>();
		const task = `\`${name}\``;
		for (const mention of mentions(task)) focusName(table, mention, task, focused, ambiguous);
		if (ambiguous.size > 0) return { groups, chosen: "ambiguous" };
		const refs = [...focused.keys()].slice(0, MAX_FOCUS_UNITS);
		return { groups, chosen: new Set(refs) };
	},
} as const;
