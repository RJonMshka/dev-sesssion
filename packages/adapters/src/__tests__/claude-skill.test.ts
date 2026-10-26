/**
 * The plan skill, over the generated `SKILL.md` (LLD-plan-authoring.md,
 * REQ-PLA-9..11). Nothing here copies the skill's text: the description, the
 * body and the example plan are all cut out of what `renderPlanSkill` emits.
 */

import { checkPlan, TokenCounter } from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { PLAN_SKILL_PATH, planSkillMarker, renderPlanSkill } from "../claude-skill.js";

const SKILL = renderPlanSkill("9.9.9");

/** Splits `SKILL.md` into its frontmatter fields and its body. */
function split(text: string): { fields: Record<string, string>; body: string } {
	const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
	if (m === null) throw new Error("SKILL.md has no frontmatter");
	const fields: Record<string, string> = Object.create(null);
	for (const line of (m[1] ?? "").split("\n")) {
		const i = line.indexOf(":");
		if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	return { fields, body: m[2] ?? "" };
}

/** The fenced markdown example, as the skill shows it. */
function examplePlan(text: string): string {
	const m = /```markdown\n([\s\S]*?)\n```/.exec(text);
	if (m === null) throw new Error("SKILL.md has no ```markdown example");
	return m[1] ?? "";
}

describe("the plan skill", () => {
	it("is written for Claude Code at .claude/skills/dev-sesssion/SKILL.md", () => {
		expect(PLAN_SKILL_PATH).toBe(".claude/skills/dev-sesssion/SKILL.md");
		expect(split(SKILL).fields.name).toBe("dev-sesssion");
	});

	it("has a description of at most 300 characters (REQ-PLA-9)", () => {
		const { description } = split(SKILL).fields;
		expect(description).toBeDefined();
		expect((description ?? "").length).toBeGreaterThan(40);
		expect((description ?? "").length).toBeLessThanOrEqual(300);
	});

	it("has a body of at most 1,500 tokens by the core counter (REQ-PLA-10)", async () => {
		const { tokens } = await TokenCounter.create().countString(split(SKILL).body);
		expect(tokens).toBeLessThanOrEqual(1_500);
	});

	it("carries the managed marker as its first body line (REQ-PLA-13)", () => {
		expect(split(SKILL).body.split("\n")[0]).toBe(planSkillMarker("9.9.9"));
	});

	it("shows an example plan that checks clean: two chunks, a brief and paths each (REQ-PLA-11)", () => {
		const report = checkPlan(examplePlan(SKILL));

		expect(report.ok).toBe(true);
		expect(report.chunks.length).toBeGreaterThanOrEqual(2);
		expect(report.excluded).toEqual([]);
		expect(report.warnings).toEqual([]);
		for (const chunk of report.chunks) {
			expect(chunk.hasBrief, `chunk ${String(chunk.id)} brief`).toBe(true);
			expect(chunk.namedPaths.length, `chunk ${String(chunk.id)} paths`).toBeGreaterThan(0);
			expect(chunk.taskCount).toBeGreaterThan(0);
		}
	});
});
