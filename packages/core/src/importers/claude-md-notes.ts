/**
 * ClaudeMdNotes — turns the `##` sections of a `CLAUDE.md` into session notes.
 *
 * `CLAUDE.md` is repository content, so each note is written as an attributed
 * quotation rather than as the session owner's own words
 * (LLD-context-provenance.md, REQ-PROV-1). The quotation is persisted, so
 * `export`, `preview` and any other reader of `SESSION_STATE.md` see it marked.
 *
 * @packageDocumentation
 */

import { formatQuotedNote } from "../formatters/formatter-utils.js";
import { splitManagedBlock } from "./managed-block.js";

/** The file the notes are attributed to. */
const SOURCE_FILE = "CLAUDE.md";

/** Characters of section body kept in a note, before the note cap applies. */
const EXCERPT_CHARS = 120;

/** One `##` section: its heading and the start of its body. */
interface Section {
	readonly title: string;
	readonly excerpt: string;
}

/** Result of {@link ClaudeMdNotes.merge}. */
export interface MergedNotes {
	/** The full notes list to persist. */
	readonly notes: readonly string[];
	/** Quoted notes that were not already present, in section order. */
	readonly added: readonly string[];
	/** How many notes in the pre-quotation form were removed. */
	readonly replaced: number;
}

/**
 * Splits markdown into `##` sections, keeping the first {@link EXCERPT_CHARS}
 * characters of each body with whitespace collapsed.
 *
 * @param content - Raw markdown.
 * @returns The sections in document order.
 */
function extractH2Sections(content: string): Section[] {
	const sections: Section[] = [];
	let currentTitle: string | null = null;
	const currentBody: string[] = [];

	const flush = (): void => {
		if (currentTitle === null) return;
		const excerpt = currentBody.join(" ").replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
		sections.push({ title: currentTitle, excerpt });
		currentBody.length = 0;
	};

	for (const line of content.split("\n")) {
		if (line.startsWith("## ")) {
			flush();
			currentTitle = line.replace(/^##\s+/, "").trim();
		} else if (currentTitle !== null && line.trim() !== "" && !line.startsWith("#")) {
			currentBody.push(line.trim());
		}
	}
	flush();
	return sections;
}

/**
 * Renders a section the way `import` did before notes were quoted. Used only to
 * recognise those notes in an existing state file (REQ-PROV-11).
 *
 * @param section - The section.
 * @returns The old note text.
 */
function unquotedForm({ title, excerpt }: Section): string {
	const base = `${SOURCE_FILE}: ${title}`;
	return excerpt.length > 0 ? `${base} — ${excerpt}` : base;
}

/**
 * Renders a section as an attributed, capped quotation.
 *
 * @param section - The section.
 * @returns The note text.
 */
function quotedForm({ title, excerpt }: Section): string {
	return formatQuotedNote({ sourceFile: SOURCE_FILE, section: title, text: excerpt });
}

/**
 * Notes an earlier import may have written that this one replaces: every
 * section's pre-quotation form (REQ-PROV-11), and every note reading the file
 * whole — managed block included — would give, less the notes this import
 * writes (REQ-RUN-9).
 *
 * @param content - The whole `CLAUDE.md` content.
 * @param sections - The sections of the owner's content alone.
 * @param current - The quoted notes this import writes.
 * @returns The notes to remove from an existing list.
 */
function staleForms(
	content: string,
	sections: readonly Section[],
	current: ReadonlySet<string>,
): Set<string> {
	const whole = extractH2Sections(content);
	const stale = new Set([
		...sections.map(unquotedForm),
		...whole.map(unquotedForm),
		...whole.map(quotedForm),
	]);
	for (const note of current) stale.delete(note);
	return stale;
}

/**
 * Builds and merges notes imported from `CLAUDE.md`.
 */
export const ClaudeMdNotes = {
	/**
	 * Builds one quoted note per `##` section (REQ-PROV-1, -4).
	 *
	 * @param content - The `CLAUDE.md` content.
	 * @returns The notes, in section order.
	 */
	build(content: string): string[] {
		// Only the owner's text becomes notes; the tool's own block does not (REQ-RUN-7, -18).
		return extractH2Sections(splitManagedBlock(content).user).map(quotedForm);
	},

	/**
	 * Merges the notes for `content` into an existing notes list.
	 *
	 * A note that is exactly a section's pre-quotation form is removed, so
	 * re-running `import` after an upgrade swaps the unmarked note for the
	 * marked one instead of keeping both (REQ-PROV-11). Anything else,
	 * including a hand-written note that merely starts with `CLAUDE.md:`, is
	 * kept. A quoted note already present is not added twice.
	 *
	 * A note an import would have written by reading the managed block as
	 * ordinary content — the block's own section, or the section before it with
	 * the start marker in its excerpt — is removed too, unless the current
	 * import writes the same note (REQ-RUN-9).
	 *
	 * @param content - The `CLAUDE.md` content.
	 * @param existing - The notes currently in `SESSION_STATE.md`.
	 * @returns The merged list, what was added, and how many old notes were removed.
	 */
	merge(content: string, existing: readonly string[]): MergedNotes {
		const sections = extractH2Sections(splitManagedBlock(content).user);
		const current = new Set(sections.map(quotedForm));
		const stale = staleForms(content, sections, current);
		const kept = existing.filter((note) => !stale.has(note));
		const present = new Set(kept);
		const added = [...current].filter((note) => !present.has(note));
		return {
			notes: [...kept, ...added],
			added,
			replaced: existing.length - kept.length,
		};
	},
} as const;
