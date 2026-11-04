import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionBackup } from "../managers/session-backup.js";

const NOW = new Date("2026-11-03T01:02:03.456Z");

let tmpDir: string;
let sessionDir: ValidatedPath;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-backup-"));
	sessionDir = path.join(tmpDir, ".session") as ValidatedPath;
	fs.mkdirSync(sessionDir);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SessionBackup.exists", () => {
	it("is false for a .session/ without SESSION_STATE.md", () => {
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), "x");
		expect(SessionBackup.exists(sessionDir)).toBe(false);
	});

	it("is true once SESSION_STATE.md exists", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), "x");
		expect(SessionBackup.exists(sessionDir)).toBe(true);
	});
});

describe("SessionBackup.moveAside", () => {
	it("moves every entry into backups/<UTC time>/ and says where (REQ-RUN-33)", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), "state");
		fs.writeFileSync(path.join(sessionDir, "PLAN_5.md"), "stale");
		fs.mkdirSync(path.join(sessionDir, "memory"));
		fs.writeFileSync(path.join(sessionDir, "memory", "a.md"), "m");

		const result = SessionBackup.moveAside(sessionDir, NOW);

		expect(result.relativeDir).toBe("backups/2026-11-03T01-02-03Z");
		expect([...result.moved].sort()).toEqual(["PLAN_5.md", "SESSION_STATE.md", "memory"]);
		expect(fs.readdirSync(sessionDir)).toEqual(["backups"]);
		const dest = path.join(sessionDir, result.relativeDir);
		expect(fs.readFileSync(path.join(dest, "SESSION_STATE.md"), "utf-8")).toBe("state");
		expect(fs.readFileSync(path.join(dest, "memory", "a.md"), "utf-8")).toBe("m");
	});

	it("leaves earlier backups where they are (REQ-RUN-33)", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), "one");
		const first = SessionBackup.moveAside(sessionDir, new Date("2026-11-01T00:00:00Z"));
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), "two");

		const second = SessionBackup.moveAside(sessionDir, NOW);

		expect(second.moved).toEqual(["SESSION_STATE.md"]);
		const read = (rel: string) =>
			fs.readFileSync(path.join(sessionDir, rel, "SESSION_STATE.md"), "utf-8");
		expect(read(first.relativeDir)).toBe("one");
		expect(read(second.relativeDir)).toBe("two");
	});

	it("adds a suffix for a second start-over in the same second (REQ-RUN-33)", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), "one");
		SessionBackup.moveAside(sessionDir, NOW);
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), "two");

		const second = SessionBackup.moveAside(sessionDir, NOW);

		expect(second.relativeDir).toBe("backups/2026-11-03T01-02-03Z-2");
	});

	it("writes a .gitignore that ignores the whole backup directory (REQ-RUN-34)", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), "state");

		SessionBackup.moveAside(sessionDir, NOW);

		const ignore = fs.readFileSync(path.join(sessionDir, "backups", ".gitignore"), "utf-8");
		expect(ignore.split("\n")).toContain("*");
	});
});
