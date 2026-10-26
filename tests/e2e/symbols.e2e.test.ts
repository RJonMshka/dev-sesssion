/**
 * `dev-sesssion symbols` through the built CLI (LLD-symbols.md).
 *
 * init + index on a copy of simple-node-app, then queries. JSON output is
 * compared with ai-index.yaml read back through core's own deserializer, and
 * the temp tree is fingerprinted to prove the command writes nothing.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../../packages/core/src/annotation/ai-index-builder.js";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/simple-node-app",
);
const FILE = "src/utils/validate.ts";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-symbols-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** init + index, failing loudly if either does. */
async function setUp(): Promise<void> {
	for (const args of [
		["init", "--yes", "--cwd", tmpDir],
		["index", "--cwd", tmpDir],
	]) {
		const r = await runCli(args);
		if (r.exitCode !== 0) throw new Error(`${args[0]} failed: ${r.stdout}\n${r.stderr}`);
	}
}

/** Every file under the temp dir with its size and mtime. */
function fingerprint(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string): void => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else {
				const st = fs.statSync(p);
				out.push(`${path.relative(dir, p)} ${String(st.size)} ${String(st.mtimeMs)}`);
			}
		}
	};
	walk(dir);
	return out.sort();
}

describe("dev-sesssion symbols", () => {
	it("prints one JSON document whose units are the index's, and writes nothing (REQ-SYM-10, -11)", async () => {
		await setUp();
		const before = fingerprint(tmpDir);

		const json = await runCli(["symbols", FILE, "--json", "--cwd", tmpDir]);
		expect(json.exitCode).toBe(0);
		const report = JSON.parse(json.stdout) as {
			path: string;
			freshness: string;
			units: { id: string; start: number; end: number; tokens: number }[];
		};
		expect(report.path).toBe(FILE);
		expect(report.freshness).toBe("current");

		const index = AiIndexBuilder.deserialize(
			fs.readFileSync(path.join(tmpDir, ".session", "ai-index.yaml"), "utf-8"),
		);
		const units = index.files[FILE]?.units ?? {};
		expect(report.units.map((u) => u.id).sort()).toEqual(Object.keys(units).sort());
		for (const u of report.units) {
			expect(u).toMatchObject({
				start: units[u.id]?.start,
				end: units[u.id]?.end,
				tokens: units[u.id]?.tokens,
			});
		}

		const text = await runCli(["symbols", FILE, "--cwd", tmpDir]);
		expect(text.exitCode).toBe(0);
		expect(text.stdout).toContain(`${FILE} · `);
		expect(text.stdout).toContain("parseBody");

		const byName = await runCli(["symbols", "--name", "parseBody", "--json", "--cwd", tmpDir]);
		expect(byName.exitCode).toBe(0);
		expect(JSON.parse(byName.stdout).matches[0].ref).toBe(`${FILE}#parseBody`);

		expect(fingerprint(tmpDir)).toEqual(before);
	});

	it("exits 1 with an empty JSON match list for an unknown name (REQ-SYM-6)", async () => {
		await setUp();
		const r = await runCli(["symbols", "--name", "doesNotExist", "--json", "--cwd", tmpDir]);
		expect(r.exitCode).toBe(1);
		expect(JSON.parse(r.stdout)).toMatchObject({ name: "doesNotExist", matches: [] });
	});

	it("names `dev-sesssion index` when there is no index, and creates nothing (REQ-SYM-12)", async () => {
		await setUp();
		fs.rmSync(path.join(tmpDir, ".session", "ai-index.yaml"));
		const before = fingerprint(tmpDir);
		const r = await runCli(["symbols", FILE, "--cwd", tmpDir]);
		expect(r.exitCode).toBe(1);
		expect(`${r.stdout}${r.stderr}`).toContain("dev-sesssion index");
		expect(fingerprint(tmpDir)).toEqual(before);
	});

	it("marks a file edited since indexing STALE and still exits 0 (REQ-SYM-13)", async () => {
		await setUp();
		fs.appendFileSync(path.join(tmpDir, FILE), "\n// edited\n");
		const r = await runCli(["symbols", FILE, "--cwd", tmpDir]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/STALE — run dev-sesssion index/);
	});

	it("names `dev-sesssion init` when there is no .session/", async () => {
		fs.rmSync(path.join(tmpDir, ".session"), { recursive: true, force: true });
		const r = await runCli(["symbols", FILE, "--cwd", tmpDir]);
		expect(r.exitCode).toBe(1);
		expect(`${r.stdout}${r.stderr}`).toContain("dev-sesssion init");
	});

	it("refuses both a path and --name, or neither, naming both forms", async () => {
		await setUp();
		for (const args of [["symbols", FILE, "--name", "parseBody"], ["symbols"]]) {
			const r = await runCli([...args, "--cwd", tmpDir]);
			expect(r.exitCode).toBe(1);
			const out = `${r.stdout}${r.stderr}`;
			expect(out).toContain("symbols <path>");
			expect(out).toContain("symbols --name <name>");
		}
	});
});
