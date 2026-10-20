/**
 * The dev-sesssion managed block — the part of `CLAUDE.md` (and opencode's
 * `AGENTS.md`) the tool writes and rewrites itself.
 *
 * The markers live here so the adapters that write the block, `export` that
 * rewrites it, and the importer that must skip it share one copy
 * (LLD-first-run.md, REQ-RUN-7).
 *
 * @packageDocumentation
 */

/** Opens the managed block. */
export const MANAGED_BLOCK_START = "<!-- dev-sesssion:start -->";

/** Closes the managed block. */
export const MANAGED_BLOCK_END = "<!-- dev-sesssion:end -->";

/** Markdown split into what the owner wrote and what the tool wrote. */
export interface SplitContent {
	/** Everything outside managed blocks, markers removed. */
	readonly user: string;
	/** Everything inside managed blocks, markers removed. */
	readonly managed: string;
}

/**
 * Splits markdown into the owner's content and the managed block's content.
 *
 * A start marker with no end marker after it runs to the end of the file
 * (REQ-RUN-8): the tool wrote the start, so what follows is more likely the
 * tool's than the owner's. An end marker with no start before it is left in
 * place as ordinary text.
 *
 * @param content - Raw markdown.
 * @returns The owner's content and the managed content.
 */
export function splitManagedBlock(content: string): SplitContent {
	const user: string[] = [];
	const managed: string[] = [];
	let rest = content;
	for (;;) {
		const start = rest.indexOf(MANAGED_BLOCK_START);
		if (start === -1) break;
		user.push(rest.slice(0, start));
		const inner = rest.slice(start + MANAGED_BLOCK_START.length);
		const end = inner.indexOf(MANAGED_BLOCK_END);
		if (end === -1) {
			managed.push(inner);
			rest = "";
			break;
		}
		managed.push(inner.slice(0, end));
		rest = inner.slice(end + MANAGED_BLOCK_END.length);
	}
	user.push(rest);
	return { user: user.join(""), managed: managed.join("") };
}
