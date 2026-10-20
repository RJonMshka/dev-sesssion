/**
 * Which files a task names (LLD-first-run.md, REQ-RUN-2, -3, -5).
 *
 * Plans carry no file list, so task text is the only signal of which files a
 * chunk needs. A task names a file when it contains a path-shaped token whose
 * trailing segments agree with the file's: `formatter-utils.ts`,
 * `formatters/formatter-utils.ts` and the full path all name
 * `packages/core/src/formatters/formatter-utils.ts`; `utils.ts` names
 * `src/utils.ts` but `formatter-utils.ts` does not.
 *
 * @packageDocumentation
 */

import type { PlanChunk } from "../schemas/index.js";

/**
 * A run of characters that can make up a repository-relative path. Anything
 * else — whitespace, backticks, quotes, brackets, `:`, `#`, `?` — ends it.
 */
const PATH_TOKEN_RE = /[A-Za-z0-9_.\-/]+/g;

/**
 * Splits text into path-shaped tokens, each as its path segments.
 *
 * Trailing dots are dropped, so `final-writes.ts.` at the end of a sentence
 * reads as `final-writes.ts`; `index.ts.map` stays `index.ts.map`. Empty and
 * `.` segments are dropped, so `./src/a.ts` and `/src/a.ts` read as `src/a.ts`.
 *
 * @param text - Task text.
 * @returns One segment list per token, skipping tokens with no segments.
 */
function pathTokens(text: string): string[][] {
	const tokens: string[][] = [];
	for (const match of text.matchAll(PATH_TOKEN_RE)) {
		const segments = match[0]
			.replace(/\.+$/, "")
			.split("/")
			.filter((s) => s !== "" && s !== ".");
		if (segments.length > 0) tokens.push(segments);
	}
	return tokens;
}

/**
 * Splits a repository-relative path into segments.
 *
 * @param filepath - Repository-relative path, `/`-separated.
 * @returns The path's segments.
 */
function fileSegments(filepath: string): string[] {
	return filepath.split("/").filter((s) => s !== "" && s !== ".");
}

/**
 * Counts how many trailing segments a token and a file share, provided every
 * segment they both have agrees. `lib/src/a.ts` and `src/a.ts` share 2;
 * `mysrc/a.ts` and `src/a.ts` share none, because `mysrc` is not `src`.
 *
 * @param token - The token's segments.
 * @param file - The file's segments.
 * @returns The number of agreeing trailing segments, or 0 if any disagree.
 */
function sharedTail(token: readonly string[], file: readonly string[]): number {
	const n = Math.min(token.length, file.length);
	for (let i = 1; i <= n; i++) {
		if (token[token.length - i] !== file[file.length - i]) return 0;
	}
	return n;
}

/**
 * Picks the one file a token names, if exactly one is the best match.
 *
 * @param token - The token's segments.
 * @param candidates - Files whose basename is the token's last segment.
 * @returns The file, or `undefined` when none match or several tie (REQ-RUN-3).
 */
function resolveToken(
	token: readonly string[],
	candidates: readonly (readonly [string, readonly string[]])[],
): string | undefined {
	let best = 0;
	let chosen: string[] = [];
	for (const [filepath, segments] of candidates) {
		const score = sharedTail(token, segments);
		if (score > best) {
			best = score;
			chosen = [filepath];
		} else if (score === best && score > 0) {
			chosen.push(filepath);
		}
	}
	return chosen.length === 1 ? chosen[0] : undefined;
}

/**
 * Groups files by basename, keeping each file's segments.
 *
 * @param files - Repository-relative paths.
 * @returns Basename → [path, segments] pairs.
 */
function byBasename(files: readonly string[]): Map<string, [string, string[]][]> {
	const groups = new Map<string, [string, string[]][]>();
	for (const filepath of files) {
		const segments = fileSegments(filepath);
		const base = segments[segments.length - 1];
		if (base === undefined) continue;
		const group = groups.get(base);
		if (group) group.push([filepath, segments]);
		else groups.set(base, [[filepath, segments]]);
	}
	return groups;
}

/**
 * True when `text` names `filepath`, by its path or by its basename as a whole
 * token (REQ-RUN-2). Unlike {@link referencedFiles}, this judges one file on its
 * own: a basename other files share still counts.
 *
 * @param text - Task text.
 * @param filepath - Repository-relative path, `/`-separated.
 * @returns Whether the text names the file.
 */
export function mentionsFile(text: string, filepath: string): boolean {
	const segments = fileSegments(filepath);
	if (segments.length === 0) return false;
	return pathTokens(text).some((token) => sharedTail(token, segments) > 0);
}

/**
 * Maps each file an unfinished task names to the chunks whose tasks name it
 * (REQ-RUN-1, -2). A token that names several files equally well — a basename
 * two files share — names none of them (REQ-RUN-3); a longer path that singles
 * one out still names it. Uniqueness is judged against `files`, the whole walk,
 * not one chunk.
 *
 * @param chunks - The plan's chunks.
 * @param files - Every walked file, repository-relative.
 * @returns File → ascending chunk ids, for referenced files only.
 */
export function referencedFiles(
	chunks: readonly PlanChunk[],
	files: readonly string[],
): Map<string, number[]> {
	const groups = byBasename(files);
	const refs = new Map<string, number[]>();
	for (const chunk of chunks) {
		for (const task of chunk.tasks) {
			if (task.status === "done") continue;
			for (const token of pathTokens(task.text)) {
				const base = token[token.length - 1];
				const candidates = base === undefined ? undefined : groups.get(base);
				const file = candidates ? resolveToken(token, candidates) : undefined;
				if (file === undefined) continue;
				const ids = refs.get(file) ?? [];
				if (!ids.includes(chunk.chunk_id)) ids.push(chunk.chunk_id);
				refs.set(file, ids);
			}
		}
	}
	for (const ids of refs.values()) ids.sort((a, b) => a - b);
	return refs;
}
