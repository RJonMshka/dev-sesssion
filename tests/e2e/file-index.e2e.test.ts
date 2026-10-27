/**
 * Files the plan names, end to end through the built CLI (LLD-file-index.md).
 *
 * The plan is shaped like DevNexus's, where 2.4.2 tagged 0 files: `## Phase N:`
 * sections whose checkboxes are a Definition of Done naming no file, with the
 * real file list in a fenced Key Files block. Phase 0 cannot be a chunk.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileIndexManager } from "../../packages/core/src/managers/file-index-manager.js";
import { PlanChunkManager } from "../../packages/core/src/managers/plan-chunk-manager.js";
import type { ValidatedPath } from "../../packages/security/src/validators/path-validator.js";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

const PLAN = `# Implementation Plan

## Phase 0: Decisions
### Definition of Done
- [ ] ADRs written

## Phase 1: Client
**Goal**: A client that retries.

### Tasks
1. Scaffold the client
2. Add retries

### Definition of Done
- [ ] Retries survive a flaky network
- [ ] Timeouts are configurable

### Key Files
\`\`\`
src/{client,utils}.ts
src/*.test.ts
\`\`\`

## Phase 2: Arithmetic
### Definition of Done
- [ ] NaN is rejected

### Key Files
\`\`\`
src/utils.ts
\`\`\`
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-file-index-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.mkdirSync(path.join(tmpDir, "docs"));
	fs.writeFileSync(path.join(tmpDir, "docs", "PLAN.md"), PLAN);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Runs init and fails loudly on a non-zero exit. */
async function init(): Promise<string> {
	const r = await runCli(["init", "--yes", "--cwd", tmpDir]);
	if (r.exitCode !== 0) throw new Error(`init failed:\n${r.stdout}\n${r.stderr}`);
	return r.stdout + r.stderr;
}

/** Files FILE_INDEX.md tags to a chunk, sorted. */
function inChunk(id: number): string[] {
	const entries = FileIndexManager.load(path.join(tmpDir, ".session") as ValidatedPath);
	return FileIndexManager.queryByChunk(entries, id)
		.map((e) => e.filepath)
		.sort();
}

describe("init --yes tags the files a plan names", () => {
	it("tags Key Files to their chunk when no task names a file (REQ-IDX-17)", async () => {
		await init();

		expect(inChunk(1)).toEqual(["src/client.ts", "src/utils.ts"]);
		expect(inChunk(2)).toEqual(["src/utils.ts"]);
	});

	it("records them in PLAN_N.md, expanded, without the glob (REQ-IDX-13, REQ-IDX-14, REQ-IDX-16)", async () => {
		await init();

		// Read back through core's loader: the brief quotes the Key Files block
		// verbatim, glob included, so grepping the frontmatter would see it.
		const [plan1] = PlanChunkManager.loadAll(path.join(tmpDir, ".session") as ValidatedPath);
		expect(plan1?.files).toEqual(["src/client.ts", "src/utils.ts"]);
	});

	it("names the tagged files on the first prompt's load line (REQ-IDX-17)", async () => {
		await init();

		const prompt = fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");
		expect(prompt).toContain("src/client.ts");
		expect(prompt).toContain("src/utils.ts");
	});

	it("says why Phase 0 was skipped (REQ-PS-20)", async () => {
		const out = await init();

		expect(out).toContain('Skipped "Phase 0: Decisions"');
		expect(out).not.toContain("declares no chunk number");
		expect(out).toMatch(/chunk ids start at 1/);
	});

	it("points the prompt at the plan file that holds the phase's goal and steps (REQ-PCX-5)", async () => {
		await init();

		const prompt = fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");
		// No CLAUDE.md in the fixture, so the plain formatter: no @-mention.
		expect(prompt).toMatch(/^Plan: @?\.session\/PLAN_1\.md$/m);
		const plan1 = fs.readFileSync(path.join(tmpDir, ".session", "PLAN_1.md"), "utf-8");
		expect(plan1).toContain("**Goal**: A client that retries.");
		expect(plan1).toContain("2. Add retries");
		// The Definition of Done is tracked as tasks, not repeated in the brief.
		expect(plan1).not.toContain("### Definition of Done");
	});
});
