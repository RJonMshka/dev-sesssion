/**
 * Secrets in doc comments through the built CLI (LLD-context-provenance.md,
 * REQ-PROV-14, -15).
 *
 * A token in an `@ai-summary` reached `ai-index.yaml` and `symbols` output,
 * and nothing said so — found by the adversarial corpus (`evals/adversarial.ts`,
 * `token-in-ai-summary`). These read what the CLI actually wrote and printed.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import stripAnsi from "strip-ansi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/run-cli.js";

// Built at runtime so no scanner-shaped token sits in the source (gitleaks).
const TOKEN = `ghp_${"Ab3".repeat(12)}`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-secret-e2e-"));
	fs.writeFileSync(
		path.join(tmpDir, "package.json"),
		JSON.stringify({ name: "secret-e2e", version: "1.0.0" }),
	);
	fs.writeFileSync(
		path.join(tmpDir, "PLAN.md"),
		"# Plan\n\n## Chunk 1 — Deploy\n\n- [ ] Fix deploy in src/deploy.ts\n",
	);
	fs.mkdirSync(path.join(tmpDir, "src"));
	fs.writeFileSync(
		path.join(tmpDir, "src", "deploy.ts"),
		`/** @ai-summary deploy with token ${TOKEN} */\nexport function deploy(): void {}\n`,
	);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Runs the CLI and returns its combined, uncoloured output. */
async function run(args: string[]): Promise<string> {
	const r = await runCli([...args, "--cwd", tmpDir]);
	expect(r.exitCode, `${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`).toBe(0);
	return stripAnsi(`${r.stdout}\n${r.stderr}`);
}

describe("a secret in a doc comment", () => {
	it("init and index warn with the file and pattern, never the value (REQ-PROV-15)", async () => {
		for (const out of [await run(["init", "--yes"]), await run(["index"])]) {
			expect(out).toContain("src/deploy.ts");
			expect(out).toContain("GitHub PAT (classic)");
			expect(out).not.toContain(TOKEN);
		}
	});

	it("index --file warns too (REQ-PROV-15)", async () => {
		await run(["init", "--yes"]);
		const out = await run(["index", "--file", "src/deploy.ts"]);
		expect(out).toContain("GitHub PAT (classic)");
		expect(out).not.toContain(TOKEN);
	});

	it("is masked in ai-index.yaml and in symbols output (REQ-PROV-14)", async () => {
		await run(["init", "--yes"]);
		await run(["index"]);
		const index = fs.readFileSync(path.join(tmpDir, ".session", "ai-index.yaml"), "utf-8");
		expect(index).not.toContain(TOKEN);
		expect(index).toContain("ghp_*");
		const shown = await run(["symbols", "src/deploy.ts"]);
		expect(shown).not.toContain(TOKEN);
		expect(shown).toContain("ghp_*");
	});
});
