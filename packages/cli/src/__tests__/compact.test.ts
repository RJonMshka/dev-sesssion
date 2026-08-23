import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CliError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompactOptions } from "../commands/compact.js";
import { runCompact } from "../commands/compact.js";

/**
 * These tests cover the pre-flight secret scan in `compact`, the only command
 * that performs network egress. They deliberately run with a fake API key: a
 * flagged file must be refused *before* any request is made, so a passing test
 * here is also proof that the guard sits upstream of the network call.
 */
describe("compact egress guard", () => {
	let tmpDir: string;
	let originalKey: string | undefined;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "compact-guard-"));
		fs.mkdirSync(path.join(tmpDir, ".session"), { recursive: true });
		originalKey = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = "sk-ant-fake-key-for-testing";
	});

	afterEach(() => {
		if (originalKey === undefined) {
			delete process.env.ANTHROPIC_API_KEY;
		} else {
			process.env.ANTHROPIC_API_KEY = originalKey;
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeOptions(overrides: Partial<CompactOptions> = {}): CompactOptions {
		return {
			cwd: tmpDir,
			dryRun: true,
			yes: true,
			verbose: false,
			allowSecrets: false,
			...overrides,
		};
	}

	function writeFixture(contents: string): string {
		const filepath = path.join(tmpDir, "notes.md");
		fs.writeFileSync(filepath, contents);
		return "notes.md";
	}

	it.each([
		["AWS access key", "aws_key = AKIAIOSFODNN7EXAMPLE"],
		["GitHub PAT", "token: ghp_012345678901234567890123456789012345"],
		["private key header", "-----BEGIN RSA PRIVATE KEY-----"],
	])("refuses to send a file containing a %s", async (_label, secret) => {
		const file = writeFixture(`# Notes\n\n${secret}\n`);
		await expect(runCompact(file, makeOptions())).rejects.toThrow(CliError);
	});

	it("names the file and does not leak the raw secret in the error", async () => {
		const file = writeFixture("# Notes\n\naws_key = AKIAIOSFODNN7EXAMPLE\n");

		let message = "";
		try {
			await runCompact(file, makeOptions());
		} catch (error: unknown) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain('Refusing to send "notes.md"');
		expect(message).toContain("AWS Access Key");
		expect(message).not.toContain("AKIAIOSFODNN7EXAMPLE");
	});

	it("reports the line number of the finding", async () => {
		const file = writeFixture("# Notes\n\n\naws_key = AKIAIOSFODNN7EXAMPLE\n");
		await expect(runCompact(file, makeOptions())).rejects.toThrow(/line 4/);
	});

	it("gets past the guard with --allow-secrets", async () => {
		const file = writeFixture("# Notes\n\naws_key = AKIAIOSFODNN7EXAMPLE\n");
		// The fake key means the API call itself fails — but reaching the API at
		// all proves the guard let this through rather than refusing up front.
		await expect(runCompact(file, makeOptions({ allowSecrets: true }))).rejects.toThrow(
			/Anthropic API call failed/,
		);
	});

	it("does not flag clean content", async () => {
		const file = writeFixture("# Notes\n\nJust ordinary prose about the project.\n");
		await expect(runCompact(file, makeOptions())).rejects.toThrow(/Anthropic API call failed/);
	});
});
