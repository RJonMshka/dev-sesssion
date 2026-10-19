import { PlainTextFormatter } from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { ClaudeBootstrapFormatter } from "../claude-bootstrap-formatter.js";
import { CursorBootstrapFormatter } from "../cursor-bootstrap-formatter.js";
import { OpencodeBootstrapFormatter } from "../opencode-bootstrap-formatter.js";
import { WindsurfBootstrapFormatter } from "../windsurf-bootstrap-formatter.js";
import { makeContext, makeState } from "./test-helpers.js";

/**
 * Provenance is marked when a note is imported, not when it is rendered
 * (LLD-context-provenance.md). A note the developer wrote, through `update`,
 * must therefore come out exactly as written: no quoting, no escaping.
 * Asserted against each formatter's real output.
 */
const FORMATTERS = [
	["plain", PlainTextFormatter],
	["claude", ClaudeBootstrapFormatter],
	["cursor", CursorBootstrapFormatter],
	["opencode", OpencodeBootstrapFormatter],
	["windsurf", WindsurfBootstrapFormatter],
] as const;

/** A note with the characters quoting would change: quotes and a backslash. */
const OWN_NOTE = 'Use "tabs" in C:\\src — decided 2026-10-19';

describe.each(FORMATTERS)("%s formatter notes", (_name, formatter) => {
	it("renders a note not derived from a repository file unchanged (REQ-PROV-3)", () => {
		const prompt = formatter.generatePrompt(
			makeContext({ state: { ...makeState(), notes: [OWN_NOTE] } }),
		);

		const noteLines = prompt
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.includes("tabs"));
		expect(noteLines).toHaveLength(1);
		expect(noteLines[0]?.endsWith(OWN_NOTE)).toBe(true);
		expect(noteLines[0]).not.toContain("Quoted");
	});
});
