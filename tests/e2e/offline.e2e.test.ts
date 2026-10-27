/**
 * dev-sesssion calls no model and sends nothing over the network
 * (LLD-offline.md, REQ-OFF-1, -3). Reads the built bundle and runs the built CLI.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import stripAnsi from "strip-ansi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLI_BIN, runCli } from "../helpers/run-cli.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-offline-e2e-"));
	fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Project\n");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("no network", () => {
	it("the published bundle holds no model API endpoint or key lookup (REQ-OFF-1)", () => {
		for (const bundle of [CLI_BIN, CLI_BIN.replace(/\.cjs$/, ".mjs")]) {
			const code = fs.readFileSync(bundle, "utf-8");
			expect(code).not.toContain("api.anthropic.com");
			expect(code).not.toContain("ANTHROPIC_API_KEY");
		}
	});
});

describe("compact", () => {
	it("says it was removed and what to use instead (REQ-OFF-3)", async () => {
		const r = await runCli(["compact", "CLAUDE.md", "--yes", "--cwd", tmpDir]);
		const out = stripAnsi(`${r.stdout}\n${r.stderr}`);
		expect(r.exitCode).toBe(1);
		expect(out).toMatch(/removed/i);
		expect(out).toMatch(/agent/i);
		expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8")).toBe("# Project\n");
	});

	it("is not listed in --help (REQ-OFF-3)", async () => {
		const r = await runCli(["--help"]);
		expect(stripAnsi(r.stdout)).not.toMatch(/^\s+compact\b/m);
	});
});
