/**
 * Target files and the default version (LLD-eval-harness.md, REQ-EVAL-13, 14).
 *
 * A target file lets a real repository outside this tree be evaluated without
 * committing it. The default version is what CI gates on, and it has drifted
 * behind the published release twice.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readDefaultVersion } from "../harness/default-version.js";
import { parseTargetFile } from "../harness/target-file.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("parseTargetFile", () => {
	it("reads an absolute source dir and per-chunk declared files (REQ-EVAL-13)", () => {
		const t = parseTargetFile({
			id: "devnexus",
			sourceDir: "/abs/DevNexus",
			expectedFiles: { "1": ["apps/shell/src/App.tsx"], "2.5": ["x.ts"] },
		});
		expect(t.id).toBe("devnexus");
		expect(t.sourceDir).toBe("/abs/DevNexus");
		expect(t.expectedFiles).toEqual({ "1": ["apps/shell/src/App.tsx"], "2.5": ["x.ts"] });
		// A real repo is evaluated as-is: one unablated run.
		expect(t.ablations).toEqual([]);
	});

	it("rejects a relative source dir, which would resolve against the wrong root (REQ-EVAL-13)", () => {
		expect(() => parseTargetFile({ id: "x", sourceDir: "rel/dir" })).toThrow(/absolute/);
	});

	it("rejects a missing id or source dir (REQ-EVAL-13)", () => {
		expect(() => parseTargetFile({ sourceDir: "/abs" })).toThrow(/id/);
		expect(() => parseTargetFile({ id: "x" })).toThrow(/sourceDir/);
	});

	it("rejects non-string paths and non-numeric chunk keys (REQ-EVAL-13)", () => {
		expect(() =>
			parseTargetFile({ id: "x", sourceDir: "/a", expectedFiles: { "1": [3] } }),
		).toThrow(/string/);
		expect(() =>
			parseTargetFile({ id: "x", sourceDir: "/a", expectedFiles: { one: ["a.ts"] } }),
		).toThrow(/chunk id/);
	});

	it("rejects a path that escapes the target (REQ-EVAL-13)", () => {
		expect(() =>
			parseTargetFile({ id: "x", sourceDir: "/a", expectedFiles: { "1": ["../etc/passwd"] } }),
		).toThrow(/repo-relative/);
	});
});

describe("readDefaultVersion", () => {
	it("is the version packages/cli/package.json declares (REQ-EVAL-14)", async () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(REPO_ROOT, "packages", "cli", "package.json"), "utf8"),
		) as { version: string };
		expect(await readDefaultVersion(REPO_ROOT)).toBe(pkg.version);
	});
});
