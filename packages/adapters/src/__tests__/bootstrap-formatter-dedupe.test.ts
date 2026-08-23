import { LOAD_PREFIX } from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { ClaudeBootstrapFormatter } from "../claude-bootstrap-formatter.js";
import { CursorBootstrapFormatter } from "../cursor-bootstrap-formatter.js";
import { OpencodeBootstrapFormatter } from "../opencode-bootstrap-formatter.js";
import { WindsurfBootstrapFormatter } from "../windsurf-bootstrap-formatter.js";
import { makeContext, makeFiles } from "./test-helpers.js";

/**
 * A file tagged both always-include (`0`) and to the active chunk used to be
 * emitted twice, because every formatter concatenated the two lists. The
 * rendered list is capped, so the duplicate evicted a real file from the prompt.
 *
 * These assert against real formatter output rather than hand-written lines —
 * a hand-written fixture cannot catch emitter drift.
 */
const FORMATTERS = [
	["claude", ClaudeBootstrapFormatter],
	["cursor", CursorBootstrapFormatter],
	["opencode", OpencodeBootstrapFormatter],
	["windsurf", WindsurfBootstrapFormatter],
] as const;

/** Extracts the rendered file references from a generated prompt. */
function loadedRefs(prompt: string): string[] {
	const line = prompt
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.startsWith(LOAD_PREFIX));
	if (line === undefined) return [];
	return line
		.slice(LOAD_PREFIX.length)
		.split(",")
		.map((p) => p.trim().replace(/^@/, ""))
		.filter((p) => p !== "" && !/^\+\d+ more$/.test(p));
}

describe.each(FORMATTERS)("%s formatter file-list dedupe", (_name, formatter) => {
	it("lists a file tagged both always-include and chunk exactly once", () => {
		const shared = {
			filepath: "CLAUDE.md",
			chunk_tags: [0, 4],
			purpose: "AI instructions",
			token_cost: 50,
		};
		const prompt = formatter.generatePrompt(
			makeContext({
				alwaysIncludeFiles: [shared],
				chunkFiles: [shared, ...makeFiles(2)],
			}),
		);

		const refs = loadedRefs(prompt);
		expect(refs.filter((r) => r === "CLAUDE.md")).toHaveLength(1);
		expect(new Set(refs).size).toBe(refs.length);
	});

	it("does not let a duplicate evict a real file from the capped list", () => {
		const shared = {
			filepath: "CLAUDE.md",
			chunk_tags: [0, 4],
			purpose: "AI instructions",
			token_cost: 50,
		};
		const withDupe = loadedRefs(
			formatter.generatePrompt(
				makeContext({ alwaysIncludeFiles: [shared], chunkFiles: [shared, ...makeFiles(3)] }),
			),
		);
		const withoutDupe = loadedRefs(
			formatter.generatePrompt(
				makeContext({ alwaysIncludeFiles: [shared], chunkFiles: makeFiles(3) }),
			),
		);
		expect(withDupe).toEqual(withoutDupe);
	});
});
