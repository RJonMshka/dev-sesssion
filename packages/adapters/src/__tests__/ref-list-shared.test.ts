/**
 * One file-reference renderer across formatters (LLD-prompt-context.md,
 * REQ-PCX-5, REQ-PCX-6).
 *
 * Six private copies of the list cap existed, at two different values. These
 * compare each formatter's real output against the shared helper's.
 */

import { formatRefList, LOAD_PREFIX, PLAN_PREFIX } from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { ClaudeBootstrapFormatter } from "../claude-bootstrap-formatter.js";
import { CursorBootstrapFormatter } from "../cursor-bootstrap-formatter.js";
import { OpencodeBootstrapFormatter } from "../opencode-bootstrap-formatter.js";
import { WindsurfBootstrapFormatter } from "../windsurf-bootstrap-formatter.js";
import { makeChunk, makeContext, makeFiles } from "./test-helpers.js";

const FORMATTERS = [
	["claude", ClaudeBootstrapFormatter, (p: string) => `@${p}`],
	["cursor", CursorBootstrapFormatter, (p: string) => p],
	["opencode", OpencodeBootstrapFormatter, (p: string) => p],
	["windsurf", WindsurfBootstrapFormatter, (p: string) => p],
] as const;

describe.each(FORMATTERS)("%s formatter", (_name, formatter, ref) => {
	it("renders its load line through formatRefList (REQ-PCX-6)", () => {
		const files = makeFiles(30);
		const prompt = formatter.generatePrompt(
			makeContext({ alwaysIncludeFiles: [], chunkFiles: files }),
		);
		const line = prompt.split("\n").find((l) => l.startsWith(LOAD_PREFIX));

		expect(line).toBe(`${LOAD_PREFIX} ${formatRefList(files.map((f) => ref(f.filepath)))}`);
	});

	it("points at the chunk's plan file when it has a brief (REQ-PCX-5)", () => {
		const chunk = makeChunk({ brief: "**Goal**: ship it." });
		const prompt = formatter.generatePrompt(makeContext({ chunk }));

		expect(prompt).toContain(`${PLAN_PREFIX} ${ref(`.session/PLAN_${String(chunk.chunk_id)}.md`)}`);
		expect(formatter.generatePrompt(makeContext())).not.toContain(PLAN_PREFIX);
	});
});
