/**
 * Notes decay (LLD-workflow-prompt.md Part A, REQ-WF-1..6).
 *
 * The prompt showed the two *oldest* notes, and init and advance filled both
 * slots with progress bookkeeping, so an owner's note never appeared after the
 * second one. Notes are put in place with core's own writers, never YAML.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatQuotedNote } from "../../packages/core/src/formatters/formatter-utils.js";
import { SessionStateManager } from "../../packages/core/src/managers/session-state-manager.js";
import type { ValidatedPath } from "../../packages/security/src/validators/path-validator.js";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

// The Problem section's scratch project: three chunks, a two-section CLAUDE.md.
const PLAN = `# Plan

## Chunk 1 — Client

- [ ] Add retries to src/client.ts
- [ ] Add a timeout to src/client.ts

## Chunk 2 — Arithmetic

- [ ] Make add reject NaN in src/utils.ts

## Chunk 3 — Polish

- [ ] Polish
`;

const CLAUDE_MD = `# Project

## Conventions

Use tabs. Prefer named exports.

## Testing

Run vitest before committing.
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-notes-decay-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
	fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), CLAUDE_MD);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sessionDir = (): ValidatedPath => path.join(tmpDir, ".session") as ValidatedPath;
const readSession = (name: string): string =>
	fs.existsSync(path.join(tmpDir, ".session", name))
		? fs.readFileSync(path.join(tmpDir, ".session", name), "utf-8")
		: "";
const cli = async (...args: string[]): Promise<void> => {
	const r = await runCli([...args, "--cwd", tmpDir]);
	expect(r.exitCode, r.stderr).toBe(0);
};
const addNotes = (...notes: string[]): void => {
	const state = notes.reduce(
		(s, n) => SessionStateManager.addNote(s, n),
		SessionStateManager.load(sessionDir()),
	);
	SessionStateManager.save(sessionDir(), state);
};
const promptNotes = (): string[] =>
	readSession("NEXT_PROMPT.md")
		.split("\n")
		.filter((l) => l.startsWith("Note: "))
		.map((l) => l.slice("Note: ".length));

describe("init and advance", () => {
	it("add no progress note to SESSION_STATE.md (REQ-WF-4)", async () => {
		await cli("init", "--yes");
		expect(SessionStateManager.load(sessionDir()).notes).toEqual([]);

		await cli("advance", "--yes");
		await cli("advance", "--yes");
		expect(SessionStateManager.load(sessionDir()).notes).toEqual([]);
	});
});

describe("advance with notes", () => {
	const owner = "Blocker: b.ts must not import a.ts (cycle)";
	const quoted = formatQuotedNote({ sourceFile: "CLAUDE.md", section: "Testing", text: "x" });

	it("moves the owner's notes into the chunk's DONE_LOG.md entry and keeps quoted ones (REQ-WF-5)", async () => {
		await cli("init", "--yes");
		addNotes(owner, quoted);

		await cli("advance", "--yes");

		expect(SessionStateManager.load(sessionDir()).notes).toEqual([quoted]);
		const log = readSession("DONE_LOG.md");
		const entry = log.slice(log.indexOf("## Chunk 1 — Client"));
		expect(entry).toContain(`Notes:\n- ${owner}\n`);
		expect(entry).not.toContain(quoted);
	});

	it("changes neither file under --dry-run (REQ-WF-5)", async () => {
		await cli("init", "--yes");
		addNotes(owner, quoted);
		const before = [readSession("SESSION_STATE.md"), readSession("DONE_LOG.md")];

		await cli("--dry-run", "advance", "--yes");

		expect([readSession("SESSION_STATE.md"), readSession("DONE_LOG.md")]).toEqual(before);
	});

	it("removes the progress notes 2.4.x wrote (REQ-WF-6)", async () => {
		await cli("init", "--yes");
		// Captured from the Problem §A run on 2.4.x.
		addNotes(
			"Completed: Chunks 1. See DONE_LOG.md for details.",
			"Session initialized on 2026-10-24",
		);

		await cli("advance", "--yes");

		expect(SessionStateManager.load(sessionDir()).notes).toEqual([]);
		expect(readSession("DONE_LOG.md")).not.toContain("Session initialized");
	});
});

describe("the Problem §A sequence, replayed", () => {
	it("shows the owner's newest note and the newest quoted note on chunk 3, never a progress note (REQ-WF-1, REQ-WF-2, REQ-WF-3)", async () => {
		await cli("init", "--yes");
		addNotes("Blocker: b.ts must not import a.ts (cycle)");
		await cli("import", "--from", "claude");
		await cli("advance", "--yes");
		await cli("advance", "--yes");

		// The chunk-1 blocker went to DONE_LOG.md (REQ-WF-5); chunk 3 gets its own.
		addNotes("Polish only the README");
		await cli("index");

		const shown = promptNotes();
		const quotedInState = SessionStateManager.load(sessionDir()).notes.filter((n) =>
			n.startsWith("Quoted from "),
		);
		expect(shown).toEqual(["Polish only the README", quotedInState.at(-1)]);
		expect(readSession("NEXT_PROMPT.md")).not.toMatch(/Session initialized|Completed: Chunks/);
	});
});
