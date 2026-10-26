import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStateManager } from "../managers/session-state-manager.js";
import type { SessionState } from "../schemas/index.js";
import { MAX_WORKFLOW_STEP_CHARS, MAX_WORKFLOW_STEPS } from "../schemas/index.js";

/**
 * The optional `workflow` field of SESSION_STATE.md (LLD-workflow-prompt.md,
 * REQ-WF-18). State is written with SessionStateManager, and malformed values
 * are put in place by editing the file the manager wrote.
 */

let dir: string;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-18-"));
});
afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

const sessionDir = (): ValidatedPath => dir as ValidatedPath;
const statePath = (): string => path.join(dir, "SESSION_STATE.md");

function baseState(): SessionState {
	return {
		active_chunk: 1,
		session_id: "s",
		last_updated: "2026-10-26",
		tasks: [{ text: "A", status: "todo" }],
		notes: [],
		last_worked_files: [],
		completed_chunks: {},
	};
}

/** Saves a valid state, then replaces its workflow block with `yaml`. */
function saveWithWorkflowYaml(yaml: string): void {
	SessionStateManager.save(sessionDir(), { ...baseState(), workflow: ["placeholder"] });
	const raw = fs.readFileSync(statePath(), "utf-8");
	const replaced = raw.replace(/^workflow:\n(?: {2}- .*\n)+/m, `${yaml}\n`);
	expect(replaced).not.toBe(raw);
	fs.writeFileSync(statePath(), replaced);
}

describe("SESSION_STATE.md workflow", () => {
	it("is optional: a state without it loads (REQ-WF-18)", () => {
		SessionStateManager.save(sessionDir(), baseState());
		expect(SessionStateManager.load(sessionDir()).workflow).toBeUndefined();
	});

	it("round-trips through toMarkdown and load (REQ-WF-18)", () => {
		const workflow = ['Write a "failing" test', "Make it pass", "Run the full suite"];
		SessionStateManager.save(sessionDir(), { ...baseState(), workflow });
		expect(SessionStateManager.load(sessionDir()).workflow).toEqual(workflow);
	});

	it("leaves a state without it serialized as before (REQ-WF-18)", () => {
		const text = SessionStateManager.toMarkdown(baseState());
		expect(text).not.toContain("workflow");
	});

	it.each([
		["no steps", "workflow: []"],
		[
			`${String(MAX_WORKFLOW_STEPS + 1)} steps`,
			`workflow:\n${Array.from({ length: MAX_WORKFLOW_STEPS + 1 }, (_, i) => `  - "s${String(i)}"`).join("\n")}`,
		],
		["a step over the cap", `workflow:\n  - "${"x".repeat(MAX_WORKFLOW_STEP_CHARS + 1)}"`],
		["a step with a line break", 'workflow:\n  - "one\\ntwo"'],
		["an empty step", 'workflow:\n  - ""'],
	])("rejects %s and names the field (REQ-WF-18)", (_label, yaml) => {
		saveWithWorkflowYaml(yaml);
		expect(() => SessionStateManager.load(sessionDir())).toThrow(/workflow/);
	});
});
