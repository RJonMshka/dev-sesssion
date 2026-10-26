/**
 * The plan skill, end to end through the built CLI (LLD-plan-authoring.md,
 * REQ-PLA-9, 13, 14). The unit tests prove the adapter's decisions; this proves
 * the CLI hands it a version and a writer that can create the skill's directory.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/run-cli.js";

const SKILL = ".claude/skills/dev-sesssion/SKILL.md";
const MARKER_RE = /^<!-- dev-sesssion:managed v(\S+) -->$/m;

const PLAN = `# Plan

## Chunk 1 — A

Goal: build a.

Files: \`src/a.ts\`

- [ ] Write src/a.ts

## Chunk 2 — B

Goal: build b.

Files: \`src/b.ts\`

- [ ] Write src/b.ts
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-plan-skill-e2e-"));
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
	fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Project\n");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Runs the CLI against the temp project and fails loudly on a non-zero exit. */
async function cli(...args: string[]): Promise<string> {
	const r = await runCli([...args, "--cwd", tmpDir]);
	if (r.exitCode !== 0) throw new Error(`${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
	return r.stdout + r.stderr;
}

const skillPath = (): string => path.join(tmpDir, SKILL);
const readSkill = (): string => fs.readFileSync(skillPath(), "utf-8");

/** Writes a file at the skill's path, creating its directory. */
function plantSkill(content: string): void {
	fs.mkdirSync(path.dirname(skillPath()), { recursive: true });
	fs.writeFileSync(skillPath(), content);
}

describe("the plan skill through the CLI", () => {
	it("init writes the skill, creating its directory, with the CLI's version (REQ-PLA-9)", async () => {
		const out = await cli("init", "-y");
		const version = (await cli("--version")).trim();

		expect(MARKER_RE.exec(readSkill())?.[1]).toBe(version);
		expect(out).toContain(`Wrote the plan skill to ${SKILL}`);
	});

	it("init leaves a skill without the marker unchanged and reports it (REQ-PLA-13)", async () => {
		plantSkill("my own skill\n");
		const out = await cli("init", "-y");

		expect(readSkill()).toBe("my own skill\n");
		expect(out).toContain(`Skipped ${SKILL}`);
	});

	it("update replaces a skill from an older version, and leaves a user's alone (REQ-PLA-14)", async () => {
		await cli("init", "-y");
		const current = readSkill();
		fs.writeFileSync(
			skillPath(),
			current.replace(MARKER_RE, "<!-- dev-sesssion:managed v0.0.1 -->"),
		);

		const out = await cli("update", "-y");
		expect(readSkill()).toBe(current);
		expect(out).toContain(`Updated the plan skill at ${SKILL}`);

		fs.writeFileSync(skillPath(), "mine\n");
		await cli("update", "-y");
		expect(readSkill()).toBe("mine\n");
	});

	it("update does not create a skill that init never wrote", async () => {
		await cli("init", "-y");
		fs.rmSync(skillPath());
		await cli("update", "-y");

		expect(fs.existsSync(skillPath())).toBe(false);
	});
});
