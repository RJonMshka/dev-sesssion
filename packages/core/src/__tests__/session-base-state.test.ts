/**
 * `session_base` in SESSION_STATE.md (LLD-tagging.md, REQ-IDX-19).
 *
 * Saved by the real manager and read back by the real loader, so the
 * hand-rolled serializer and the schema are tested against each other.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PathValidator, type ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStateManager } from "../managers/session-state-manager.js";
import { type SessionState, SessionStateSchema } from "../schemas/index.js";

let root: string;
let sessionDir: ValidatedPath;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "session-base-"));
	fs.mkdirSync(path.join(root, ".session"));
	sessionDir = PathValidator.safeResolvePath(".session", root);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const STATE: SessionState = SessionStateSchema.parse({
	active_chunk: 2,
	session_id: "s-1",
	last_updated: "2026-10-26",
});

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("session_base (REQ-IDX-19)", () => {
	it("round-trips a base with a commit and dirty files, including awkward paths", () => {
		const base = {
			commit: COMMIT,
			dirty: [
				{ path: "src/a.ts", hash: "0123456789abcdef" },
				{ path: 'odd "name"\\x.ts', hash: "fedcba9876543210" },
			],
		};
		SessionStateManager.save(sessionDir, { ...STATE, session_base: base });
		expect(SessionStateManager.load(sessionDir).session_base).toEqual(base);
	});

	it("round-trips a base with no commit and no dirty files", () => {
		SessionStateManager.save(sessionDir, { ...STATE, session_base: { dirty: [] } });
		expect(SessionStateManager.load(sessionDir).session_base).toEqual({ dirty: [] });
	});

	it("writes no session_base key for a state without one", () => {
		SessionStateManager.save(sessionDir, STATE);
		const text = fs.readFileSync(path.join(root, ".session", "SESSION_STATE.md"), "utf-8");
		expect(text).not.toContain("session_base");
		expect(SessionStateManager.load(sessionDir).session_base).toBeUndefined();
	});

	it("rejects a commit id that is not 40 or 64 hex characters", () => {
		const bad = { ...STATE, session_base: { commit: COMMIT.slice(1), dirty: [] } };
		expect(SessionStateSchema.safeParse(bad).success).toBe(false);
		const sha256 = { ...STATE, session_base: { commit: `${COMMIT}${"a".repeat(24)}`, dirty: [] } };
		expect(SessionStateSchema.safeParse(sha256).success).toBe(true);
	});
});
