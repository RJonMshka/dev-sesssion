/**
 * `plan check` (LLD-plan-authoring.md, REQ-PLA-1..6).
 *
 * The command an agent runs after writing a plan, to learn whether `init` will
 * read it — without running `init`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPlan } from "../../packages/core/src/parsers/plan-sources/index.js";
import { runCli } from "../helpers/run-cli.js";

const GOOD = `# Plan

## Chunk 1 — Client

Goal: retry failed requests.

Files: \`src/client.ts\`

- [ ] Add retries

## Chunk 2 — Release

- [ ] Publish
`;

const LOSES_WORK = "## Chunk 1 — Auth\n- [ ] login\n\n## Milestone — Billing\n- [ ] stripe\n";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-plan-check-e2e-"));
	fs.writeFileSync(path.join(tmpDir, "good.md"), GOOD);
	fs.writeFileSync(path.join(tmpDir, "loses-work.md"), LOSES_WORK);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Every path under the temp dir with its contents, to prove nothing changed. */
function snapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const full = path.join(entry.parentPath, entry.name);
		out[path.relative(dir, full)] = fs.readFileSync(full, "utf-8");
	}
	return out;
}

describe("plan check --json", () => {
	it("prints exactly the core report as one JSON document (REQ-PLA-5)", async () => {
		const r = await runCli(["plan", "check", "good.md", "--json", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual(JSON.parse(JSON.stringify(checkPlan(GOOD))));
	});

	it("prints JSON and exits non-zero for a plan that loses tasks (REQ-PLA-4, REQ-PLA-5)", async () => {
		const r = await runCli(["plan", "check", "loses-work.md", "--json", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(1);
		const report = JSON.parse(r.stdout) as { ok: boolean; excluded: unknown[] };
		expect(report.ok).toBe(false);
		expect(report.excluded).toHaveLength(1);
	});

	it("prints JSON and exits non-zero for an unrecognized plan (REQ-PLA-4)", async () => {
		fs.writeFileSync(path.join(tmpDir, "prose.md"), "Just prose.\n");
		const r = await runCli(["plan", "check", "prose.md", "--json", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(1);
		expect((JSON.parse(r.stdout) as { source: unknown }).source).toBeNull();
	});
});

describe("plan check", () => {
	it("names the source, each chunk, and what it skipped (REQ-PLA-1..3)", async () => {
		const ok = await runCli(["plan", "check", "good.md", "--cwd", tmpDir]);
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout).toContain("headings");
		expect(ok.stdout).toContain("1. Client");
		expect(ok.stdout).toContain("src/client.ts");

		const bad = await runCli(["plan", "check", "loses-work.md", "--cwd", tmpDir]);
		expect(bad.exitCode).toBe(1);
		expect(`${bad.stdout}${bad.stderr}`).toContain("Milestone — Billing");
	});

	it("creates and modifies no file (REQ-PLA-6)", async () => {
		const before = snapshot(tmpDir);

		await runCli(["plan", "check", "good.md", "--cwd", tmpDir]);
		await runCli(["plan", "check", "loses-work.md", "--json", "--cwd", tmpDir]);

		expect(snapshot(tmpDir)).toEqual(before);
	});

	it("rejects a path outside the project root", async () => {
		const r = await runCli(["plan", "check", "../outside.md", "--cwd", tmpDir]);

		expect(r.exitCode).not.toBe(0);
		expect(fs.existsSync(path.join(tmpDir, ".session"))).toBe(false);
	});

	it("reports a missing file without a stack trace", async () => {
		const r = await runCli(["plan", "check", "nope.md", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(1);
		expect(`${r.stdout}${r.stderr}`).toContain("nope.md");
		expect(`${r.stdout}${r.stderr}`).not.toContain(tmpDir);
	});
});
