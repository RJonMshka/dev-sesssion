/**
 * Files a chunk will create (LLD-new-files.md, REQ-NEW-1, 4, 5, 6).
 *
 * DevNexus phase 8 named eight files that did not exist yet, and its prompt
 * pointed the agent at nothing but CLAUDE.md.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

const PLAN = `# Plan

## Phase 1: Route transitions

### Tasks
1. Animate route changes

### Key Files
\`\`\`
src/routing/transitions.ts
src/client.ts
\`\`\`

### Definition of Done
- [ ] Transitions run on every route change
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-new-files-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
	fs.mkdirSync(path.join(tmpDir, "src", "routing"));
	fs.writeFileSync(
		path.join(tmpDir, "src", "routing", "outlet.ts"),
		"/** Mounts the active route. */\nexport function mountOutlet(): void {}\n",
	);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function cli(...args: string[]): Promise<string> {
	const r = await runCli([...args, "--cwd", tmpDir]);
	if (r.exitCode !== 0) throw new Error(`${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
	return r.stdout;
}

function read(rel: string): string {
	return fs.readFileSync(path.join(tmpDir, rel), "utf-8");
}

describe("a plan-named file that does not exist yet", () => {
	it("is stated, and the code beside it loaded but not indexed (REQ-NEW-1, 4, 5, 6)", async () => {
		await cli("init", "--yes");
		const prompt = read(".session/NEXT_PROMPT.md");

		// REQ-NEW-1: stated as plain text, not as a reference to open.
		expect(prompt).toContain("Not on disk yet: src/routing/transitions.ts");
		// REQ-NEW-4: its sibling is loaded.
		expect(prompt).toMatch(/^(Load|Summaries)[^\n]*src\/routing\/outlet\.ts/m);
		// REQ-NEW-6: the guess is not persisted.
		expect(read(".session/FILE_INDEX.md")).not.toContain("src/routing/outlet.ts");

		// REQ-NEW-5: status charges what the prompt charged.
		const line = /Budget: ~(\d+)\//.exec(prompt);
		const status = JSON.parse(await cli("status", "--json")) as {
			budget: { capped_tokens: number };
		};
		expect(status.budget.capped_tokens).toBe(Number(line?.[1]));
	});
});
