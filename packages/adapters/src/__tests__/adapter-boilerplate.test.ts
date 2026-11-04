import { sessionLoopLines } from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { generateSessionSection as claudeSection } from "../claude-adapter.js";
import { generateSessionSection as cursorSection } from "../cursor-adapter.js";
import { generateSessionSection as opencodeSection } from "../opencode-adapter.js";
import { generateSessionSection as windsurfSection } from "../windsurf-adapter.js";

/**
 * The instruction boilerplate each adapter writes into its rules file used to
 * hardcode "15 lines" while the code enforced 20, and it drifted silently
 * because nothing asserted on it. It now comes from one core function and
 * tells the agent to let the CLI write the prompt, so it states no cap at all.
 */
const SECTIONS = [
	["claude", claudeSection],
	["cursor", cursorSection],
	["opencode", opencodeSection],
	["windsurf", windsurfSection],
] as const;

describe.each(SECTIONS)("%s adapter boilerplate", (_name, generate) => {
	const section = generate("demo-project", ".session");

	it("carries the shared session loop verbatim (REQ-TASK-14)", () => {
		const style = _name === "cursor" || _name === "windsurf" ? "plain" : "markdown";
		for (const line of sessionLoopLines(".session", style)) expect(section).toContain(line);
	});

	it("states no prompt line cap: the tool writes the prompt, not the agent (REQ-TASK-10)", () => {
		expect(section).not.toMatch(/\d+ lines/);
	});

	it("points at the real repository if it links one at all", () => {
		for (const [url] of section.matchAll(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/g)) {
			expect(url).toBe("https://github.com/RJonMshka/dev-sesssion");
		}
	});
});
