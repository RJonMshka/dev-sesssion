import { formatQuotedNote, PlainTextFormatter } from "@dev-session/core";
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

/** Note lines as the formatter rendered them, without the `Note: ` prefix. */
function renderedNotes(prompt: string): string[] {
	return prompt
		.split("\n")
		.filter((l) => l.startsWith("Note: "))
		.map((l) => l.slice("Note: ".length));
}

describe.each(FORMATTERS)("%s formatter note selection", (_name, formatter) => {
	// The Problem §A run's notes, in the order 2.4.x left them on chunk 3.
	const notes = [
		"Completed: Chunks 1. See DONE_LOG.md for details.",
		"Session initialized on 2026-10-24",
		"Blocker: b.ts must not import a.ts (cycle)",
		formatQuotedNote({ sourceFile: "CLAUDE.md", section: "Conventions", text: "Use tabs." }),
		formatQuotedNote({ sourceFile: "CLAUDE.md", section: "Testing", text: "Run vitest." }),
	];

	it("shows the owner's note and the newest derived note, never a progress note (REQ-WF-1, REQ-WF-2, REQ-WF-3)", () => {
		const prompt = formatter.generatePrompt(makeContext({ state: { ...makeState(), notes } }));
		expect(renderedNotes(prompt)).toEqual([notes[2], notes[4]]);
	});
});
