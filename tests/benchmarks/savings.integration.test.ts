/**
 * Benchmark honesty (LLD-eval-harness.md, REQ-EVAL-15..17).
 *
 * On DevNexus, 2.4.2's benchmark printed "99.8% saved — 620× smaller" for a
 * context that named zero files, against a baseline in which one lockfile was
 * 30% of the total. A saving measured against nothing is not a saving.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { computeSavings, isLockfile, isPlanFile } from "./savings.js";

describe("computeSavings", () => {
	it("reports no ratio when the context names no files (REQ-EVAL-15)", () => {
		const s = computeSavings(202_315, 326, 0);
		expect(s.applicable).toBe(false);
		expect(s.ratio).toBe("n/a");
	});

	it("reports the ratio when the context names files (REQ-EVAL-15)", () => {
		const s = computeSavings(1000, 100, 3);
		expect(s.applicable).toBe(true);
		expect(s.ratio).toBe("10.0×");
		expect(s.percentSaved).toBe(90);
	});
});

describe("baseline exclusions", () => {
	it("treats package-manager lockfiles as lockfiles at any depth (REQ-EVAL-16)", () => {
		for (const f of [
			"pnpm-lock.yaml",
			"package-lock.json",
			"yarn.lock",
			"bun.lockb",
			"apps/web/package-lock.json",
		]) {
			expect(isLockfile(f), f).toBe(true);
		}
	});

	it("keeps ordinary files in the baseline (REQ-EVAL-16)", () => {
		for (const f of ["package.json", "src/lock.ts", "docs/locking.md"]) {
			expect(isLockfile(f), f).toBe(false);
		}
	});
});

describe("plan-only developer pattern", () => {
	it("finds a plan under docs/, where DevNexus keeps it (REQ-EVAL-17)", () => {
		expect(isPlanFile("docs/PLAN.md")).toBe(true);
		expect(isPlanFile("PLAN.md")).toBe(true);
		expect(isPlanFile("PLAN_2.md")).toBe(true);
	});

	it("does not count a nested package's plan as the project plan (REQ-EVAL-17)", () => {
		expect(isPlanFile("apps/web/PLAN.md")).toBe(false);
		expect(isPlanFile("docs/PLANNING.md")).toBe(false);
	});
});
