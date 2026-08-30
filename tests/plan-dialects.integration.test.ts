import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PlanParser } from "../packages/core/src/parsers/plan-parser.js";
import { parsePlan } from "../packages/core/src/parsers/plan-sources/index.js";

/**
 * Integration coverage for the plan source registry
 * (docs/plan/LLD-plan-sources.md, area PS).
 *
 * Two halves. The first runs the dialects measured as yielding zero chunks
 * against the shipped parser. The second runs this repository's own plan
 * documents — 1063 and 1400+ lines, maintained by hand over nineteen chunks —
 * as the regression anchor, on the same reasoning as the FILE_INDEX round-trip
 * test: every synthetic fixture passed against the broken serializer, and only
 * a real document exposed it.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readRepoPlan = (relative: string): string =>
	fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");

describe("plan dialects that previously yielded zero chunks", () => {
	it("parses an h3-structured plan (REQ-PS-5)", () => {
		const content = [
			"# Roadmap",
			"",
			"### Auth",
			"- [ ] login",
			"- [ ] logout",
			"",
			"### Billing",
			"- [ ] stripe",
		].join("\n");

		const { source, result } = parsePlan(content);

		expect(source.name).toBe("headings");
		expect(result.chunks.map((c) => c.title)).toEqual(["Auth", "Billing"]);
		expect(result.chunks[0]?.tasks).toHaveLength(2);
	});

	it("parses an h1-per-section plan (REQ-PS-5)", () => {
		const { result } = parsePlan("# Auth\n- [ ] login\n\n# Billing\n- [ ] stripe\n");

		expect(result.chunks.map((c) => c.title)).toEqual(["Auth", "Billing"]);
	});

	it("parses a heading-free task list into one chunk (REQ-PS-14)", () => {
		const { source, result } = parsePlan("- [ ] login\n- [x] stripe\n- [ ] ship\n");

		expect(source.name).toBe("task-list");
		expect(result.chunks).toHaveLength(1);
		expect(result.chunks[0]?.tasks).toHaveLength(3);
	});

	it("honours the numbers a Phase-titled plan declares (REQ-PS-6)", () => {
		const content = [
			"## Phase 3 — Auth",
			"- [ ] login",
			"",
			"## Phase 7 — Deploy",
			"> Depends on: Phase 3",
			"- [ ] ship",
		].join("\n");

		const { result } = parsePlan(content);

		expect(result.chunks.map((c) => c.chunk_id)).toEqual([3, 7]);
		// The declared number and the dependency now agree; before, the chunks
		// were renumbered to 1 and 2 while the dependency still read 3.
		expect(result.chunks[1]?.depends_on).toEqual([3]);
		expect(result.warnings).toEqual([]);
	});

	it("surfaces work in sections it skips, rather than dropping it (REQ-PS-10)", () => {
		const content = [
			"## Chunk 1 — Auth",
			"- [ ] login",
			"",
			"## Notes",
			"- [ ] this used to vanish silently",
		].join("\n");

		const { result } = parsePlan(content);

		expect(result.chunks).toHaveLength(1);
		expect(result.excluded).toHaveLength(1);
		expect(result.excluded[0]?.taskCount).toBe(1);
	});
});

describe("this repository's own plan documents", () => {
	// Captured from the shipped parser at fc38979, before the registry existed.
	// These are the ids that must not move.
	const BASELINE: ReadonlyArray<readonly [string, readonly number[]]> = [
		["docs/archive/PLAN.md", [1, 2, 3, 4, 5, 6, 7, 8, 9, 3.5, 10, 11, 12, 13, 14, 15, 16]],
		["docs/archive/PLANv2.md", [12, 13, 14, 15, 16, 17]],
	];

	for (const [relative, expectedIds] of BASELINE) {
		it(`parses ${relative} to the same chunk ids as before the registry (REQ-PS-4)`, () => {
			const { source, result } = parsePlan(readRepoPlan(relative));

			expect(source.name).toBe("headings");
			expect(result.chunks.map((c) => c.chunk_id)).toEqual([...expectedIds]);
		});

		it(`keeps PlanParser.fromMarkdown agreeing with parsePlan on ${relative}`, () => {
			const content = readRepoPlan(relative);

			expect(PlanParser.fromMarkdown(content)).toEqual([...parsePlan(content).result.chunks]);
		});
	}

	it("splits PLANv2.md on h2 despite two h1s and fenced YAML comments (REQ-PS-18)", () => {
		// PLANv2.md opens with two consecutive h1 lines and contains fenced YAML
		// whose comments (`# .session/ai-index.yaml`) match the heading pattern.
		// Both would misdirect a depth rule that did not skip fences.
		const { result } = parsePlan(readRepoPlan("docs/archive/PLANv2.md"));

		expect(result.chunks).toHaveLength(6);
		expect(result.chunks.every((c) => c.chunk_id >= 12)).toBe(true);
	});

	it("reports the tasks PLANv2.md has been losing silently (REQ-PS-10)", () => {
		const { result } = parsePlan(readRepoPlan("docs/archive/PLANv2.md"));

		const withWork = result.excluded.filter((e) => e.taskCount > 0);

		// `## Revision — 2026-04-14` declares no chunk number, so it is correctly
		// left out of the chunk list — but it carries real task items that the
		// old parser discarded without a word.
		expect(withWork).toHaveLength(1);
		expect(withWork[0]?.heading).toContain("Revision");
		expect(withWork[0]?.taskCount).toBeGreaterThan(0);
	});

	it("finds no dangling dependencies in either document (REQ-PS-13)", () => {
		for (const [relative] of BASELINE) {
			expect(parsePlan(readRepoPlan(relative)).result.warnings).toEqual([]);
		}
	});
});
