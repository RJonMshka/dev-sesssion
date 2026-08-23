import { DEFAULT_MAX_PROMPT_LINES } from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { generateSessionSection as claudeSection } from "../claude-adapter.js";
import { generateSessionSection as cursorSection } from "../cursor-adapter.js";
import { generateSessionSection as opencodeSection } from "../opencode-adapter.js";
import { generateSessionSection as windsurfSection } from "../windsurf-adapter.js";

/**
 * The instruction boilerplate each adapter writes into its rules file used to
 * hardcode "15 lines" while the code enforced 20, and it drifted silently
 * because nothing asserted on it. These tie the rendered text to the constant
 * so the two cannot diverge again.
 */
const SECTIONS = [
	["claude", claudeSection],
	["cursor", cursorSection],
	["opencode", opencodeSection],
	["windsurf", windsurfSection],
] as const;

describe.each(SECTIONS)("%s adapter boilerplate", (_name, generate) => {
	const section = generate("demo-project", ".session");

	it("states the prompt line cap using the shared constant", () => {
		expect(section).toContain(String(DEFAULT_MAX_PROMPT_LINES));
	});

	it("does not hardcode a line cap that disagrees with the constant", () => {
		const caps = [...section.matchAll(/(?:≤|max )(\d+) lines/g)].map((m) => Number(m[1]));
		expect(caps.length).toBeGreaterThan(0);
		for (const cap of caps) {
			expect(cap).toBe(DEFAULT_MAX_PROMPT_LINES);
		}
	});

	it("describes the cap as a default, since max_prompt_lines is configurable", () => {
		expect(section).toMatch(/lines by default/);
	});

	it("points at the real repository if it links one at all", () => {
		for (const [url] of section.matchAll(/https:\/\/github\.com\/[\w-]+\/[\w.-]+/g)) {
			expect(url).toBe("https://github.com/RJonMshka/dev-sesssion");
		}
	});
});
