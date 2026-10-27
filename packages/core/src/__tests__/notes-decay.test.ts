import { describe, expect, it } from "vitest";
import {
	formatQuotedNote,
	isProgressNote,
	MEMORY_NOTE_PREFIX,
	selectNotes,
} from "../formatters/formatter-utils.js";
import { SessionStateManager } from "../managers/session-state-manager.js";
import type { SessionState } from "../schemas/index.js";

/**
 * Notes decay (LLD-workflow-prompt.md Part A). Which notes the prompt shows,
 * and which notes `advance` keeps in SESSION_STATE.md.
 *
 * The progress-note strings below are the ones 2.4.x wrote, captured from the
 * Problem §A run; no shipped writer produces them any more (REQ-WF-4).
 */
const CAPTURED_INIT_NOTE = "Session initialized on 2026-10-24";
const CAPTURED_COMPLETED_NOTE = "Completed: Chunks 1. See DONE_LOG.md for details.";
const CAPTURED_COMPLETED_RANGE = "Completed: Chunks 1-3. See DONE_LOG.md for details.";
const CAPTURED_COMPLETED_LIST = "Completed: Chunks 1, 3. See DONE_LOG.md for details.";

function emptyState(): SessionState {
	return {
		active_chunk: 1,
		session_id: "s",
		last_updated: "2026-10-26",
		tasks: [],
		notes: [],
		last_worked_files: [],
		completed_chunks: {},
	};
}

/** Notes appended the way `update` and `import` append them. */
function withNotes(notes: readonly string[]): SessionState {
	return notes.reduce((s, n) => SessionStateManager.addNote(s, n), emptyState());
}

const quoted = formatQuotedNote({
	sourceFile: "CLAUDE.md",
	section: "Testing",
	text: "Run vitest before committing.",
});
const memory = `${MEMORY_NOTE_PREFIX}Prefers small commits`;

describe("selectNotes", () => {
	it("shows the most recently added notes, newest first (REQ-WF-1)", () => {
		const { notes } = withNotes(["first", "second", "third"]);
		expect(selectNotes(notes, 2)).toEqual(["third", "second"]);
	});

	it("shows the owner's notes ahead of quoted and [memory] notes, even newer ones (REQ-WF-2)", () => {
		const { notes } = withNotes(["mine, older", quoted, memory]);
		expect(selectNotes(notes, 2)).toEqual(["mine, older", memory]);
		expect(selectNotes(notes, 3)).toEqual(["mine, older", memory, quoted]);
	});

	it("hides both progress shapes but shows an owner's note starting `Completed:` (REQ-WF-3)", () => {
		const own = "Completed: the migration";
		const { notes } = withNotes([CAPTURED_INIT_NOTE, own, CAPTURED_COMPLETED_NOTE]);
		expect(selectNotes(notes, 5)).toEqual([own]);
	});
});

describe("isProgressNote", () => {
	it("matches the whole note in either shape the tool wrote (REQ-WF-3)", () => {
		for (const note of [
			CAPTURED_INIT_NOTE,
			CAPTURED_COMPLETED_NOTE,
			CAPTURED_COMPLETED_RANGE,
			CAPTURED_COMPLETED_LIST,
		]) {
			expect(isProgressNote(note)).toBe(true);
		}
		for (const note of [
			"Completed: the migration",
			`${CAPTURED_INIT_NOTE} — and the cache was cold`,
			`Note: ${CAPTURED_COMPLETED_NOTE}`,
		]) {
			expect(isProgressNote(note)).toBe(false);
		}
	});
});

describe("SessionStateManager.takeChunkNotes", () => {
	it("moves the owner's notes out and keeps derived notes (REQ-WF-5)", () => {
		const state = withNotes(["blocker: b.ts must not import a.ts", quoted, memory, "second"]);
		const { state: next, archived } = SessionStateManager.takeChunkNotes(state);
		expect(archived).toEqual(["blocker: b.ts must not import a.ts", "second"]);
		expect(next.notes).toEqual([quoted, memory]);
	});

	it("drops progress notes without archiving them (REQ-WF-6)", () => {
		const state = withNotes([CAPTURED_COMPLETED_NOTE, CAPTURED_INIT_NOTE, "mine"]);
		const { state: next, archived } = SessionStateManager.takeChunkNotes(state);
		expect(archived).toEqual(["mine"]);
		expect(next.notes).toEqual([]);
	});
});

describe("SessionStateManager.compact", () => {
	it("adds no progress note and removes the old ones (REQ-WF-4, REQ-WF-6)", () => {
		const state: SessionState = {
			...withNotes([CAPTURED_COMPLETED_NOTE, CAPTURED_INIT_NOTE, "mine"]),
			completed_chunks: { "1": "2026-10-24", "2": "2026-10-25" },
		};
		expect(SessionStateManager.compact(state).notes).toEqual(["mine"]);
	});
});
