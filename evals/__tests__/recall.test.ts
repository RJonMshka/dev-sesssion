/**
 * Context recall — whether the generated context points at the files a chunk's
 * work needs (LLD-eval-harness.md, REQ-EVAL-10..12).
 *
 * Every other deterministic check asks whether the context is wrong; an empty
 * context passes all of them. These pin the arithmetic that catches it.
 *
 * The FILE_INDEX and prompt samples are captured verbatim from a real `init`
 * on the workspace build (2026-10-21), not written by hand.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { fileIndexByChunk, promptRecallFailed, scoreRecall } from "../checks/recall.js";

/** `init -y` on a three-file repo whose plan names each file in a task. */
const TAGGED_INDEX = `---
version: 1
last_updated: "2026-10-22"
---

# File Index

## Chunk 1

| File | Purpose |
|---|---|
| src/a.ts | a module |
| src/b.ts | b module |

## Chunk 2

| File | Purpose |
|---|---|
| src/c.ts | c module |
`;

/** `init -y` on DevNexus with 2.4.2: nothing tagged, CLAUDE.md always-included. */
const UNTAGGED_INDEX = `---
version: 1
last_updated: "2026-10-22"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI session instructions |
`;

/** The prompt written alongside TAGGED_INDEX. */
const TAGGED_PROMPT = `Project: tiny
Active chunk: 1 — Start
Budget: ~100/4000 tokens [OK]
Load full: @src/a.ts, @src/b.ts
Do NOT read: **/__tests__/**, **/dist/**, **/node_modules/**, .session/PLAN_2.md
Resume: 0/2 tasks done
`;

describe("fileIndexByChunk", () => {
	it("groups rows under the chunk heading they appear beneath (REQ-EVAL-10)", () => {
		const idx = fileIndexByChunk(TAGGED_INDEX);
		expect(idx.chunks.get(1)).toEqual(["src/a.ts", "src/b.ts"]);
		expect(idx.chunks.get(2)).toEqual(["src/c.ts"]);
		expect(idx.alwaysInclude).toEqual([]);
	});

	it("reads always-include rows separately from chunk rows (REQ-EVAL-10)", () => {
		const idx = fileIndexByChunk(UNTAGGED_INDEX);
		expect(idx.alwaysInclude).toEqual(["CLAUDE.md"]);
		expect(idx.chunks.size).toBe(0);
	});

	it("reads fractional chunk ids (REQ-EVAL-10)", () => {
		const idx = fileIndexByChunk("## Chunk 3.5\n\n| File | Purpose |\n|---|---|\n| x.ts | x |\n");
		expect(idx.chunks.get(3.5)).toEqual(["x.ts"]);
	});
});

describe("scoreRecall", () => {
	it("scores the share of present declared files that were named (REQ-EVAL-11)", () => {
		const r = scoreRecall(["src/a.ts", "src/c.ts"], ["src/a.ts", "src/b.ts"]);
		expect(r).toEqual({ hit: 1, total: 2, ratio: 0.5, missed: ["src/c.ts"] });
	});

	it("is null when nothing is declared, so absence is never scored as 0 (REQ-EVAL-10)", () => {
		expect(scoreRecall([], ["src/a.ts"]).ratio).toBeNull();
	});

	it("scores DevNexus-shaped output — only CLAUDE.md named — as zero (REQ-EVAL-10)", () => {
		const named = fileIndexByChunk(UNTAGGED_INDEX).alwaysInclude;
		const r = scoreRecall(["apps/shell/src/App.tsx", "turbo.json"], named);
		expect(r.hit).toBe(0);
		expect(r.ratio).toBe(0);
	});
});

describe("promptRecallFailed", () => {
	it("fails when the prompt names none of the present declared files (REQ-EVAL-12)", () => {
		const named = ["CLAUDE.md"];
		expect(promptRecallFailed(scoreRecall(["src/a.ts"], named))).toBe(true);
	});

	it("passes when the prompt names at least one (REQ-EVAL-12)", () => {
		const named = ["src/a.ts", "src/b.ts"];
		expect(promptRecallFailed(scoreRecall(["src/a.ts", "src/z.ts"], named))).toBe(false);
	});

	it("does not fail a target that declares nothing (REQ-EVAL-12)", () => {
		expect(promptRecallFailed(scoreRecall([], []))).toBe(false);
	});

	it("passes the captured prompt against its own chunk's files (REQ-EVAL-11)", async () => {
		const { declaredFromPrompt } = await import("../checks/grounding.js");
		const r = scoreRecall(["src/a.ts", "src/b.ts"], declaredFromPrompt(TAGGED_PROMPT));
		expect(r.ratio).toBe(1);
		expect(promptRecallFailed(r)).toBe(false);
	});
});
