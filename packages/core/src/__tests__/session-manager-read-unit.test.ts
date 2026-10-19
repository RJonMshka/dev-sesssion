/**
 * `SessionManager.readUnit` — loading one code unit on demand
 * (LLD-code-units.md, REQ-UNIT-23..25).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CliError, SecurityError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../managers/session-manager.js";

const SOURCE = [
	"export function first(): number {",
	"  return 1;",
	"}",
	"",
	"/** Second. */",
	"export function secondThing(): number {",
	"  return 2;",
	"}",
	"",
].join("\n");

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "read-unit-"));
	fs.mkdirSync(path.join(root, ".session"));
	fs.mkdirSync(path.join(root, "src"));
	fs.writeFileSync(path.join(root, "src", "nums.ts"), SOURCE);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe("SessionManager.readUnit", () => {
	it("returns the unit's lines under a traceable header (REQ-UNIT-23)", () => {
		const out = SessionManager.create(root).readUnit("src/nums.ts#secondThing");
		const [header, ...body] = out.split("\n");
		expect(header).toMatch(
			/^\/\/ src\/nums\.ts#secondThing L5-8 · \d+ tokens · hash [0-9a-f]{16}$/,
		);
		expect(body.join("\n")).toBe(SOURCE.split("\n").slice(4, 8).join("\n"));
	});

	it("reads the file as it stands now, not as last indexed (REQ-UNIT-23)", () => {
		const mgr = SessionManager.create(root);
		fs.writeFileSync(
			path.join(root, "src", "nums.ts"),
			`// moved\n\n${SOURCE.replace("2;", "22;")}`,
		);
		const out = mgr.readUnit("src/nums.ts#secondThing");
		expect(out).toContain("L7-10");
		expect(out).toContain("return 22;");
	});

	it("accepts the line-range suffix a Focus line carries (REQ-UNIT-23)", () => {
		const out = SessionManager.create(root).readUnit("src/nums.ts#first:1-3");
		expect(out).toContain("return 1;");
	});

	it("lists the file's unit ids when the id is unknown (REQ-UNIT-24)", () => {
		const mgr = SessionManager.create(root);
		expect(() => mgr.readUnit("src/nums.ts#third")).toThrow(CliError);
		try {
			mgr.readUnit("src/nums.ts#third");
		} catch (error: unknown) {
			const e = error as CliError;
			expect(`${e.message} ${e.suggestion ?? ""}`).toContain("first, secondThing");
		}
	});

	it("rejects a reference without an id", () => {
		expect(() => SessionManager.create(root).readUnit("src/nums.ts")).toThrow(CliError);
	});

	it("refuses a path outside the project root (REQ-UNIT-25)", () => {
		expect(() => SessionManager.create(root).readUnit("../../etc/passwd#x")).toThrow(SecurityError);
	});
});
