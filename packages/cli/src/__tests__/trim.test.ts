import { describe, expect, it } from "vitest";
import type { TrimCandidate } from "../commands/trim.js";
import { autoSelectExclusions } from "../commands/trim.js";

describe("autoSelectExclusions", () => {
	const makeCandidates = (...entries: Array<[string, number, boolean]>): TrimCandidate[] =>
		entries.map(([filepath, tokens, alreadyExcluded]) => ({
			filepath,
			tokens,
			alreadyExcluded,
		}));

	it("returns empty array when already within budget", () => {
		const candidates = makeCandidates(["a.ts", 100, false], ["b.ts", 200, false]);
		const result = autoSelectExclusions(candidates, 300, 400);
		expect(result).toHaveLength(0);
	});

	it("selects the largest file first to reach budget", () => {
		const candidates = makeCandidates(["large.ts", 1000, false], ["small.ts", 100, false]);
		const result = autoSelectExclusions(candidates, 1200, 400);
		expect(result).toContain("large.ts");
	});

	it("skips already-excluded files", () => {
		const candidates = makeCandidates(["already-out.ts", 1000, true], ["small.ts", 100, false]);
		const result = autoSelectExclusions(candidates, 1100, 500);
		expect(result).not.toContain("already-out.ts");
	});

	it("selects multiple files when one is not enough", () => {
		const candidates = makeCandidates(
			["a.ts", 400, false],
			["b.ts", 400, false],
			["c.ts", 100, false],
		);
		// Total = 900, need to reach 200 → must exclude 'a' and 'b'
		const result = autoSelectExclusions(candidates, 900, 200);
		expect(result).toContain("a.ts");
		expect(result).toContain("b.ts");
		expect(result).not.toContain("c.ts");
	});

	it("stops once budget is reached", () => {
		const candidates = makeCandidates(
			["a.ts", 500, false],
			["b.ts", 500, false],
			["c.ts", 500, false],
		);
		// Total = 1500, budget = 1100 → only exclude 'a' (500 off = 1000)
		const result = autoSelectExclusions(candidates, 1500, 1100);
		expect(result).toHaveLength(1);
		expect(result).toContain("a.ts");
	});

	it("returns empty when all files are already excluded", () => {
		const candidates = makeCandidates(["a.ts", 1000, true], ["b.ts", 1000, true]);
		const result = autoSelectExclusions(candidates, 2000, 100);
		expect(result).toHaveLength(0);
	});
});
