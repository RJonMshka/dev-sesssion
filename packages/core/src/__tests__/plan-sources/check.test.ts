import { describe, expect, it } from "vitest";
import {
	checkPlan,
	describeExclusion,
	detectPlanSource,
	parsePlan,
} from "../../parsers/plan-sources/index.js";

/** Requirements: docs/plan/LLD-plan-authoring.md (area PLA). */

const GOOD = `# Plan

## Chunk 1 — Client

Goal: retry failed requests.

Files: \`src/client.ts\`

- [ ] Add retries
- [x] Add a timeout

## Chunk 2 — Release

- [ ] Publish
`;

/** One chunk declares a number, the other does not and carries a task. */
const LOSES_WORK = `## Chunk 1 — Auth
- [ ] login

## Milestone — Billing
- [ ] stripe
`;

describe("checkPlan — source and candidates", () => {
	it("reports the selected source, its confidence, and every candidate (REQ-PLA-1)", () => {
		const report = checkPlan(GOOD);
		const ranked = detectPlanSource(GOOD);

		expect(report.source).toEqual({
			name: ranked[0]?.source.name,
			confidence: ranked[0]?.detection.confidence,
		});
		expect(report.candidates).toEqual(
			ranked.map((c) => ({
				name: c.source.name,
				confidence: c.detection.confidence,
				reason: c.detection.reason,
			})),
		);
	});

	it("reports no source but still ranks candidates for an unrecognized plan (REQ-PLA-1)", () => {
		const report = checkPlan("Just some prose about the project.\n");

		expect(report.source).toBeNull();
		expect(report.ok).toBe(false);
		expect(report.candidates.length).toBe(detectPlanSource("x").length);
		expect(report.chunks).toEqual([]);
	});
});

describe("checkPlan — chunks", () => {
	it("reports each chunk's id, title, tasks, brief and named paths (REQ-PLA-2)", () => {
		const report = checkPlan(GOOD);
		const parsed = parsePlan(GOOD).result.chunks;

		expect(report.chunks).toEqual(
			parsed.map((c) => ({
				id: c.chunk_id,
				title: c.title,
				taskCount: c.tasks.length,
				hasBrief: c.brief !== undefined,
				namedPaths: c.files ?? [],
			})),
		);
		// The fixture must exercise both sides of hasBrief and namedPaths.
		expect(report.chunks[0]?.hasBrief).toBe(true);
		expect(report.chunks[0]?.namedPaths.length).toBeGreaterThan(0);
		expect(report.chunks[1]?.hasBrief).toBe(false);
	});
});

describe("checkPlan — exclusions and warnings", () => {
	it("reports exclusions and dangling dependencies from parsePlan (REQ-PLA-3)", () => {
		const content = `${LOSES_WORK}\n## Chunk 2 — Deploy\nDepends on: Chunk 9\n- [ ] ship\n`;
		const report = checkPlan(content);
		const { result } = parsePlan(content);

		expect(result.excluded.length).toBeGreaterThan(0);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(report.excluded).toEqual(result.excluded);
		expect(report.warnings).toEqual(result.warnings);
	});
});

describe("checkPlan — ok", () => {
	it("is ok for a plan that parses without losing tasks (REQ-PLA-4)", () => {
		expect(checkPlan(GOOD).ok).toBe(true);
	});

	it("is not ok when a section carrying tasks is excluded (REQ-PLA-4)", () => {
		expect(checkPlan(LOSES_WORK).ok).toBe(false);
	});

	it("stays ok when only a task-free section is excluded (REQ-PLA-4)", () => {
		const content = "## Overview\nProse only.\n\n## Chunk 1 — Auth\n- [ ] login\n";
		const report = checkPlan(content);

		expect(report.excluded.length).toBeGreaterThan(0);
		expect(report.ok).toBe(true);
	});

	it("is not ok for empty content (REQ-PLA-4)", () => {
		const report = checkPlan("   \n");

		expect(report.ok).toBe(false);
		expect(report.source).toBeNull();
	});
});

describe("describeExclusion", () => {
	it("names a reason for each exclusion kind (REQ-PS-20)", () => {
		expect(describeExclusion("unrepresentable-id")).toMatch(/start at 1/);
		expect(describeExclusion("no-position-declared")).toMatch(/declares no chunk number/);
	});
});
