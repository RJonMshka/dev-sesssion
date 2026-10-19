/**
 * Checking a context manifest against the code as it stands now
 * (LLD-code-units.md, REQ-UNIT-20..22).
 *
 * The manifest is produced by the real pipeline over real files, then the
 * files are edited the way a session would edit them.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import { LayerResolver } from "../calculators/layer-resolver.js";
import type { GitReader } from "../git/git-reader.js";
import { ContextManifest } from "../managers/context-manifest.js";
import type { ContextManifestData } from "../schemas/context-manifest.js";
import { ContextManifestChecker } from "../verifiers/context-manifest-checker.js";
import { SessionVerifier } from "../verifiers/session-verifier.js";

const UTILS = [
	"/** Adds. */",
	"export function addNumbers(a: number, b: number): number {",
	"  return a + b;",
	"}",
	"",
	"export function subtractNumbers(a: number, b: number): number {",
	"  return a - b;",
	"}",
	"",
].join("\n");

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-checker-"));
	fs.mkdirSync(path.join(root, "src"));
	fs.writeFileSync(path.join(root, "src", "utils.ts"), UTILS);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** Builds the manifest a prompt naming both functions would get. */
function manifestNow(): ContextManifestData {
	const parsed = new AutoExtractor().extractFile(
		path.join(root, "src", "utils.ts") as ValidatedPath,
	);
	const index = AiIndexBuilder.build([parsed], root);
	const plan = LayerResolver.plan({
		chunkFiles: [],
		alwaysIncludeFiles: [],
		tasks: [{ text: "Fix addNumbers and subtractNumbers", status: "todo" }],
		index,
	});
	expect(plan.focus).toHaveLength(2);
	return ContextManifest.build({ plan, index, prompt: "p", activeChunk: 1 });
}

/** Rewrites src/utils.ts. */
function rewrite(content: string): void {
	fs.writeFileSync(path.join(root, "src", "utils.ts"), content);
}

describe("ContextManifestChecker", () => {
	it("reports nothing while the code is unchanged", () => {
		expect(ContextManifestChecker.check(manifestNow(), root)).toEqual([]);
	});

	it("reports STALE_CONTEXT when a unit's source changed (REQ-UNIT-20)", () => {
		const manifest = manifestNow();
		rewrite(UTILS.replace("return a + b;", "return a + b + 0;"));
		const findings = ContextManifestChecker.check(manifest, root);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.code).toBe("STALE_CONTEXT");
		expect(findings[0]?.severity).toBe("warning");
		expect(findings[0]?.message).toContain("src/utils.ts#addNumbers");
		expect(findings[0]?.message).not.toContain("subtractNumbers");
	});

	it("reports MOVED_CONTEXT when a unit is unchanged but its lines shifted (REQ-UNIT-21)", () => {
		const manifest = manifestNow();
		rewrite(`import "x";\n\n${UTILS}`);
		const findings = ContextManifestChecker.check(manifest, root);
		expect(findings.map((f) => f.code)).toEqual(["MOVED_CONTEXT"]);
		expect(findings[0]?.severity).toBe("info");
		expect(findings[0]?.message).toContain("src/utils.ts#addNumbers");
		expect(findings[0]?.message).toContain("src/utils.ts#subtractNumbers");
	});

	it("reports STALE_CONTEXT naming a removed unit (REQ-UNIT-22)", () => {
		const manifest = manifestNow();
		rewrite(UTILS.split("\n").slice(0, 5).join("\n"));
		const findings = ContextManifestChecker.check(manifest, root);
		expect(findings.map((f) => f.code)).toEqual(["STALE_CONTEXT"]);
		expect(findings[0]?.message).toMatch(/removed.*src\/utils\.ts#subtractNumbers/);
	});

	it("reports every unit removed when the file itself is gone (REQ-UNIT-22)", () => {
		const manifest = manifestNow();
		fs.rmSync(path.join(root, "src", "utils.ts"));
		const findings = ContextManifestChecker.check(manifest, root);
		expect(findings.map((f) => f.code)).toEqual(["STALE_CONTEXT"]);
		expect(findings[0]?.message).toContain("addNumbers");
		expect(findings[0]?.message).toContain("subtractNumbers");
	});

	it("does not read a manifest path outside the project root", () => {
		const manifest = manifestNow();
		const hostile: ContextManifestData = {
			...manifest,
			entries: manifest.entries.map((e) => ({
				...e,
				path: "../outside.ts",
				ref: "../outside.ts#x",
			})),
		};
		const findings = ContextManifestChecker.check(hostile, root);
		expect(findings.map((f) => f.code)).toEqual(["STALE_CONTEXT"]);
	});
});

describe("SessionVerifier with a manifest", () => {
	/** A git reader for a directory that is not a repository. */
	const notARepo = { isRepo: async () => false } as unknown as typeof GitReader;

	it("checks the manifest even outside a git repository (REQ-UNIT-20)", async () => {
		const manifest = manifestNow();
		rewrite(UTILS.replace("return a + b;", "return b + a;"));
		const report = await SessionVerifier.verify(
			{
				cwd: root,
				state: {
					active_chunk: 1,
					session_id: "s",
					last_updated: "2026-10-18",
					tasks: [],
					last_worked_files: [],
					notes: [],
					completed_chunks: {},
					max_prompt_lines: 20,
				},
				chunk: { chunk_id: 1, title: "t", depends_on: [], tasks: [] },
				entries: [],
				manifest,
			},
			notARepo,
		);
		expect(report.findings.map((f) => f.code).sort()).toEqual(["NOT_A_REPO", "STALE_CONTEXT"]);
		expect(report.warningCount).toBe(1);
	});
});
