import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPlan, parsePlan } from "../packages/core/src/parsers/plan-sources/index.js";

/**
 * `checkPlan` over this repo's real, hand-maintained plans
 * (docs/plan/LLD-plan-authoring.md, area PLA). The report must agree with what
 * `init` would ingest — the same `parsePlan` result — on documents nobody tidied.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLANS = ["docs/archive/PLAN.md", "docs/archive/PLANv2.md"] as const;

describe.each(PLANS)("checkPlan on %s", (relative) => {
	const content = fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
	const report = checkPlan(content);
	const { source, result } = parsePlan(content);

	it("reports the source and chunk ids init would ingest (REQ-PLA-1, REQ-PLA-2)", () => {
		expect(report.source?.name).toBe(source.name);
		expect(report.chunks.map((c) => c.id)).toEqual(result.chunks.map((c) => c.chunk_id));
	});

	it("reports the same exclusions and warnings init would (REQ-PLA-3)", () => {
		expect(report.excluded).toEqual(result.excluded);
		expect(report.warnings).toEqual(result.warnings);
	});

	it("is ok exactly when init would lose no task (REQ-PLA-4)", () => {
		const losesWork = result.excluded.some((e) => e.taskCount > 0);
		expect(report.ok).toBe(result.chunks.length > 0 && !losesWork);
	});
});

it("fails PLANv2, whose 'Revision' section init would drop with its tasks (REQ-PLA-4)", () => {
	const content = fs.readFileSync(path.join(REPO_ROOT, "docs/archive/PLANv2.md"), "utf-8");
	const report = checkPlan(content);

	expect(report.ok).toBe(false);
	expect(report.excluded.find((e) => e.taskCount > 0)?.heading).toMatch(/^Revision/);
});
