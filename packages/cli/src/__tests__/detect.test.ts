import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectInfo } from "@dev-session/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectExistingSession,
	detectPackageJson,
	detectPlanFile,
	detectToolFiles,
	runDetection,
} from "../commands/detect.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a minimal ProjectInfo for testing. */
function makeProjectInfo(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
	return {
		tool: "unknown",
		project_type: "unknown",
		existing_files: [],
		project_root: tmpDir,
		has_existing_session: false,
		...overrides,
	} as ProjectInfo;
}

describe("detectPlanFile", () => {
	it("returns found: false when no PLAN.md exists", () => {
		const result = detectPlanFile(tmpDir);
		expect(result.found).toBe(false);
		expect(result.relativePath).toBeUndefined();
		expect(result.lineCount).toBe(0);
	});

	it("detects PLAN.md at root", () => {
		fs.writeFileSync(
			path.join(tmpDir, "PLAN.md"),
			"## Chunk 1\n\n- [ ] Task 1\n\n## Chunk 2\n\n- [ ] Task 2\n",
		);
		const result = detectPlanFile(tmpDir);
		expect(result.found).toBe(true);
		expect(result.relativePath).toBe("PLAN.md");
		expect(result.lineCount).toBeGreaterThan(0);
		expect(result.headingCount).toBe(2);
		expect(result.estimatedChunks).toBe(2);
	});

	it("detects docs/PLAN.md", () => {
		fs.mkdirSync(path.join(tmpDir, "docs"));
		fs.writeFileSync(path.join(tmpDir, "docs", "PLAN.md"), "## Phase 1\n\nSome content\n");
		const result = detectPlanFile(tmpDir);
		expect(result.found).toBe(true);
		expect(result.relativePath).toBe("docs/PLAN.md");
	});

	it("prefers root PLAN.md over docs/PLAN.md", () => {
		fs.writeFileSync(path.join(tmpDir, "PLAN.md"), "## Root\n");
		fs.mkdirSync(path.join(tmpDir, "docs"));
		fs.writeFileSync(path.join(tmpDir, "docs", "PLAN.md"), "## Docs\n");
		const result = detectPlanFile(tmpDir);
		expect(result.relativePath).toBe("PLAN.md");
	});

	it("handles empty PLAN.md", () => {
		fs.writeFileSync(path.join(tmpDir, "PLAN.md"), "");
		const result = detectPlanFile(tmpDir);
		expect(result.found).toBe(true);
		expect(result.headingCount).toBe(0);
		expect(result.estimatedChunks).toBe(0);
	});
});

describe("detectToolFiles", () => {
	it("detects CLAUDE.md", () => {
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude\n");
		const result = detectToolFiles(tmpDir, makeProjectInfo({ tool: "claude" }));
		expect(result.hasClaude).toBe(true);
		expect(result.hasAgents).toBe(false);
		expect(result.detectedTool).toBe("claude");
	});

	it("detects AGENTS.md", () => {
		fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Agents\n");
		const result = detectToolFiles(tmpDir, makeProjectInfo({ tool: "opencode" }));
		expect(result.hasClaude).toBe(false);
		expect(result.hasAgents).toBe(true);
		expect(result.detectedTool).toBe("opencode");
	});

	it("detects both CLAUDE.md and AGENTS.md", () => {
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude\n");
		fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Agents\n");
		const result = detectToolFiles(tmpDir, makeProjectInfo());
		expect(result.hasClaude).toBe(true);
		expect(result.hasAgents).toBe(true);
	});
});

describe("detectPackageJson", () => {
	it("detects when package.json is in existing_files", () => {
		const result = detectPackageJson(
			makeProjectInfo({
				existing_files: ["package.json"],
				project_name: "my-app",
			}),
		);
		expect(result.found).toBe(true);
		expect(result.projectName).toBe("my-app");
	});

	it("returns found: false when no package.json", () => {
		const result = detectPackageJson(makeProjectInfo());
		expect(result.found).toBe(false);
		expect(result.projectName).toBeUndefined();
	});
});

describe("detectExistingSession", () => {
	it("returns exists: true when session exists", () => {
		const result = detectExistingSession(makeProjectInfo({ has_existing_session: true }));
		expect(result.exists).toBe(true);
	});

	it("returns exists: false when no session", () => {
		const result = detectExistingSession(makeProjectInfo());
		expect(result.exists).toBe(false);
	});
});

describe("runDetection", () => {
	it("aggregates all detection results", () => {
		fs.writeFileSync(path.join(tmpDir, "PLAN.md"), "## Chunk 1\n");
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude\n");

		const info = makeProjectInfo({
			existing_files: ["package.json", "PLAN.md", "CLAUDE.md"],
			project_name: "test-project",
			tool: "claude",
		});

		const result = runDetection(tmpDir, info);

		expect(result.plan.found).toBe(true);
		expect(result.toolFiles.hasClaude).toBe(true);
		expect(result.packageJson.found).toBe(true);
		expect(result.packageJson.projectName).toBe("test-project");
		expect(result.session.exists).toBe(false);
	});
});
