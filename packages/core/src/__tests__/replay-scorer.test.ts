import { describe, expect, it } from "vitest";
import { formatLayeredContextLines } from "../formatters/formatter-utils.js";
import type { GitReader } from "../git/git-reader.js";
import { extractDeclaredFiles, ReplayScorer } from "../verifiers/replay-scorer.js";

/**
 * Builds a fake GitReader over an in-memory history.
 *
 * @param opts - The history to serve.
 * @returns An object satisfying the GitReader contract.
 */
function fakeReader(opts: {
	tracked?: boolean;
	boundaries?: Array<{ sha: string; date: string; subject: string }>;
	promptAt?: Record<string, string>;
	changed?: Record<string, string[]>;
}): typeof GitReader {
	return {
		isRepo: async () => true,
		isTracked: async () => opts.tracked ?? true,
		dirtyFiles: async () => [],
		commitsTouching: async () => opts.boundaries ?? [],
		fileAtRev: async (_cwd: string, rev: string) => opts.promptAt?.[rev] ?? null,
		changedBetween: async (_cwd: string, from: string, to: string) =>
			opts.changed?.[`${from}..${to}`] ?? [],
	} as unknown as typeof GitReader;
}

describe("extractDeclaredFiles", () => {
	it("reads Claude-style @ mentions", () => {
		expect(extractDeclaredFiles("Load: @src/a.ts, @src/b.ts\n")).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("reads the legacy field name", () => {
		expect(extractDeclaredFiles("Files to load: src/a.ts\n")).toEqual(["src/a.ts"]);
	});

	it("reads layered sections from REAL formatter output", () => {
		// Feeding a hand-written "Summaries:" line would pass while the real
		// formatter emits "Summaries (read_file_layer for detail):" with a
		// trailing layer marker. Generate the prompt instead of imagining it.
		const lines = formatLayeredContextLines(
			[
				{ filepath: "src/a.ts", layer: 2, escalated: true, tokens: 100, fullTokens: 100 },
				{ filepath: "src/b.ts", layer: 1, escalated: false, tokens: 20, fullTokens: 80 },
				{ filepath: "src/c.ts", layer: 0, escalated: false, tokens: 5, fullTokens: 60 },
			] as Parameters<typeof formatLayeredContextLines>[0],
			(f) => `@${f}`,
			5,
		);

		expect(extractDeclaredFiles(lines.join("\n")).sort()).toEqual([
			"src/a.ts",
			"src/b.ts",
			"src/c.ts",
		]);
	});

	it("strips the layer marker from summary paths", () => {
		const prompt = "Summaries (read_file_layer for detail): @src/b.ts\u00b7L1, @src/c.ts\u00b7L0\n";
		expect(extractDeclaredFiles(prompt).sort()).toEqual(["src/b.ts", "src/c.ts"]);
	});

	it("ignores the +N more summary and (none)", () => {
		expect(extractDeclaredFiles("Load: src/a.ts, +4 more\n")).toEqual(["src/a.ts"]);
		expect(extractDeclaredFiles("Load: (none)\n")).toEqual([]);
	});

	it("ignores non-path prose and other lines", () => {
		expect(extractDeclaredFiles("Project: demo\nResume: did stuff\nNext:\n- a task\n")).toEqual([]);
	});

	it("deduplicates repeated references", () => {
		expect(extractDeclaredFiles("Load: @src/a.ts\nSummaries: @src/a.ts\n")).toEqual(["src/a.ts"]);
	});
});

describe("ReplayScorer", () => {
	it("reports why scoring is impossible when the prompt is untracked", async () => {
		const report = await ReplayScorer.run("/repo", fakeReader({ tracked: false }));
		expect(report.boundariesScored).toBe(0);
		expect(report.unavailableReason).toContain("not tracked by git");
	});

	it("scores precision and recall against the following commits", async () => {
		// Prompt declared a.ts and b.ts; the session actually touched a.ts and c.ts.
		// hits = {a}, so precision = 1/2, recall = 1/2.
		const report = await ReplayScorer.run(
			"/repo",
			fakeReader({
				boundaries: [{ sha: "sha1", date: "2026-08-01T00:00:00Z", subject: "session end" }],
				promptAt: { sha1: "Load: @src/a.ts, @src/b.ts\n" },
				changed: { "sha1..HEAD": ["src/a.ts", "src/c.ts"] },
			}),
		);

		const score = report.scores[0];
		expect(score?.hits).toEqual(["src/a.ts"]);
		expect(score?.missed).toEqual(["src/c.ts"]);
		expect(score?.unused).toEqual(["src/b.ts"]);
		expect(score?.precision).toBe(0.5);
		expect(score?.recall).toBe(0.5);
		expect(report.wasteRatio).toBe(0.5);
	});

	it("scores a perfect prompt as 100% with zero waste", async () => {
		const report = await ReplayScorer.run(
			"/repo",
			fakeReader({
				boundaries: [{ sha: "sha1", date: "2026-08-01T00:00:00Z", subject: "s" }],
				promptAt: { sha1: "Load: @src/a.ts\n" },
				changed: { "sha1..HEAD": ["src/a.ts"] },
			}),
		);
		expect(report.meanPrecision).toBe(1);
		expect(report.meanRecall).toBe(1);
		expect(report.wasteRatio).toBe(0);
	});

	it("compares each older boundary against the one that superseded it", async () => {
		const report = await ReplayScorer.run(
			"/repo",
			fakeReader({
				boundaries: [
					{ sha: "new", date: "2026-08-02T00:00:00Z", subject: "s2" },
					{ sha: "old", date: "2026-08-01T00:00:00Z", subject: "s1" },
				],
				promptAt: { new: "Load: @src/x.ts\n", old: "Load: @src/y.ts\n" },
				changed: { "new..HEAD": ["src/x.ts"], "old..new": ["src/y.ts"] },
			}),
		);
		expect(report.boundariesScored).toBe(2);
		expect(report.meanRecall).toBe(1);
	});

	it("excludes bookkeeping paths from the score", async () => {
		const report = await ReplayScorer.run(
			"/repo",
			fakeReader({
				boundaries: [{ sha: "sha1", date: "2026-08-01T00:00:00Z", subject: "s" }],
				promptAt: { sha1: "Load: @src/a.ts\n" },
				changed: { "sha1..HEAD": ["src/a.ts", ".session/SESSION_STATE.md", "docs/GUIDE.md"] },
			}),
		);
		expect(report.scores[0]?.touched).toEqual(["src/a.ts"]);
		expect(report.scores[0]?.recall).toBe(1);
	});

	it("returns null ratios rather than NaN when there is nothing to divide by", async () => {
		const report = await ReplayScorer.run(
			"/repo",
			fakeReader({
				boundaries: [{ sha: "sha1", date: "2026-08-01T00:00:00Z", subject: "s" }],
				promptAt: { sha1: "Load: (none)\n" },
				changed: { "sha1..HEAD": [] },
			}),
		);
		expect(report.scores[0]?.precision).toBeNull();
		expect(report.scores[0]?.recall).toBeNull();
	});
});
