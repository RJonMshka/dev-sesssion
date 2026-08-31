/**
 * Prompt-parsing coverage for the deterministic tier.
 *
 * Requirements: docs/plan/LLD-eval-harness.md (area EVAL).
 *
 * `duplicatePromptRefs` is what found the 2.2.1 dedupe bug; `declaredFromPrompt`
 * feeds the grounding check, so a truncation marker counted as a path would
 * report a missing file that was never claimed. Both are pure string handling
 * over formatter output, and both are load-bearing for published numbers.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import {
	declaredFromAdapterFile,
	declaredFromFileIndex,
	declaredFromPrompt,
	duplicatePromptRefs,
} from "../checks/grounding.js";

describe("declared paths", () => {
	it("reads a plain load line (REQ-EVAL-4)", () => {
		expect(declaredFromPrompt("Load: src/a.ts, src/b.ts\n")).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("strips the Claude @-mention prefix (REQ-EVAL-4)", () => {
		expect(declaredFromPrompt("Load: @src/a.ts, @src/b.ts\n")).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("does not treat a truncation marker as a declared path (REQ-EVAL-4)", () => {
		// `+11 more` is how the formatter caps the list. Counting it as a path
		// makes the grounding check report a missing file that was never claimed.
		expect(declaredFromPrompt("Load: src/a.ts, +11 more\n")).toEqual(["src/a.ts"]);
	});

	it("strips the layer suffix from summary refs (REQ-EVAL-4)", () => {
		expect(declaredFromPrompt("Summaries (read_file_layer for detail): @src/a.ts·L1\n")).toEqual([
			"src/a.ts",
		]);
	});

	it("prefers the longer prefix when one is a prefix of another (REQ-EVAL-4)", () => {
		// "Load full:" must win over "Load:", or the rest is sliced at the wrong
		// offset and every path picks up a stray "full:" fragment.
		expect(declaredFromPrompt("Load full: src/a.ts\n")).toEqual(["src/a.ts"]);
	});

	it("ignores the empty-list sentinel (REQ-EVAL-4)", () => {
		expect(declaredFromPrompt("Load: (none)\n")).toEqual([]);
	});

	it("ignores lines that are not load lines (REQ-EVAL-4)", () => {
		const prompt = ["Project: demo", "Resume: 1/3 tasks done", "Note: loaded the wrong thing"].join(
			"\n",
		);
		expect(declaredFromPrompt(prompt)).toEqual([]);
	});

	it("merges refs across several load lines, deduplicated (REQ-EVAL-4)", () => {
		const prompt = "Load full: src/a.ts\nSummaries (read_file_layer for detail): @src/a.ts·L0\n";
		expect(declaredFromPrompt(prompt)).toEqual(["src/a.ts"]);
	});
});

describe("duplicate refs", () => {
	it("reports a path the prompt names twice (REQ-EVAL-3)", () => {
		// The load list is capped, so a duplicate evicts a real file rather than
		// merely looking untidy. This is the 2.2.1 bug.
		expect(duplicatePromptRefs("Load: CLAUDE.md, src/a.ts, CLAUDE.md\n")).toEqual(["CLAUDE.md"]);
	});

	it("reports a duplicate that spans two load lines (REQ-EVAL-3)", () => {
		const prompt = "Load full: @src/a.ts\nSummaries (read_file_layer for detail): @src/a.ts·L1\n";
		expect(duplicatePromptRefs(prompt)).toEqual(["src/a.ts"]);
	});

	it("reports each duplicated path once, however often it repeats (REQ-EVAL-3)", () => {
		expect(duplicatePromptRefs("Load: a.ts, a.ts, a.ts\n")).toEqual(["a.ts"]);
	});

	it("reports nothing when every ref is distinct (REQ-EVAL-3)", () => {
		expect(duplicatePromptRefs("Load: a.ts, b.ts, c.ts\n")).toEqual([]);
	});

	it("does not report a repeated truncation marker as duplicated (REQ-EVAL-3)", () => {
		expect(duplicatePromptRefs("Load full: +2 more\nLoad: +2 more\n")).toEqual([]);
	});
});

describe("other declaration sources", () => {
	it("reads the adapter file's bullet list (REQ-EVAL-4)", () => {
		const adapter = ["# Files to load", "", "- `src/a.ts`", "- `src/b.ts`", "", "# Next"].join(
			"\n",
		);
		expect(declaredFromAdapterFile(adapter)).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("stops at the next heading (REQ-EVAL-4)", () => {
		const adapter = ["# Files to load", "- `src/a.ts`", "# Other", "- `src/never.ts`"].join("\n");
		expect(declaredFromAdapterFile(adapter)).toEqual(["src/a.ts"]);
	});

	it("skips the FILE_INDEX header and separator rows (REQ-EVAL-4)", () => {
		const index = [
			"## Chunk 1",
			"| File | Purpose |",
			"|---|---|",
			"| src/a.ts | does a thing |",
		].join("\n");
		expect(declaredFromFileIndex(index)).toEqual(["src/a.ts"]);
	});
});
