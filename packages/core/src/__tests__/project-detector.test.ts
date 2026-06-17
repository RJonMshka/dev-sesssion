import * as fs from "node:fs";
import * as path from "node:path";
import { CliError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectDetector } from "../detectors/project-detector.js";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, ".tmp-"));
}

describe("ProjectDetector", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("detect", () => {
		it("detects Claude tool from CLAUDE.md", () => {
			fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude");
			const info = ProjectDetector.detect(tmpDir);
			expect(info.tool).toBe("claude");
		});

		it("detects opencode tool from AGENTS.md", () => {
			fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Agents");
			const info = ProjectDetector.detect(tmpDir);
			expect(info.tool).toBe("opencode");
		});

		it("detects cursor tool from .cursor/ directory", () => {
			fs.mkdirSync(path.join(tmpDir, ".cursor"));
			const info = ProjectDetector.detect(tmpDir);
			expect(info.tool).toBe("cursor");
		});

		it("detects windsurf tool from .windsurfrules file", () => {
			fs.writeFileSync(path.join(tmpDir, ".windsurfrules"), "# rules");
			const info = ProjectDetector.detect(tmpDir);
			expect(info.tool).toBe("windsurf");
		});

		it("detects windsurf tool from .windsurf/ directory", () => {
			fs.mkdirSync(path.join(tmpDir, ".windsurf"));
			const info = ProjectDetector.detect(tmpDir);
			expect(info.tool).toBe("windsurf");
		});

		it("returns unknown for no tool indicators", () => {
			const info = ProjectDetector.detect(tmpDir);
			expect(info.tool).toBe("unknown");
		});

		it("detects existing notable files", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"test"}');
			fs.mkdirSync(path.join(tmpDir, ".git"));

			const info = ProjectDetector.detect(tmpDir);
			expect(info.existing_files).toContain("package.json");
			expect(info.existing_files).toContain(".git");
		});

		it("reads project name from package.json", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"my-project"}');
			const info = ProjectDetector.detect(tmpDir);
			expect(info.project_name).toBe("my-project");
		});

		it("handles missing package.json gracefully", () => {
			const info = ProjectDetector.detect(tmpDir);
			expect(info.project_name).toBeUndefined();
		});

		it("handles malformed package.json gracefully", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "not json");
			const info = ProjectDetector.detect(tmpDir);
			expect(info.project_name).toBeUndefined();
		});

		it("sets project_root to the cwd", () => {
			const info = ProjectDetector.detect(tmpDir);
			expect(info.project_root).toBe(tmpDir);
		});

		it("throws CliError for nonexistent directory", () => {
			expect(() => ProjectDetector.detect("/nonexistent/path/xyz")).toThrow(CliError);
		});
	});

	describe("hasExistingSession", () => {
		it("returns true when .session/ exists", () => {
			fs.mkdirSync(path.join(tmpDir, ".session"));
			expect(ProjectDetector.hasExistingSession(tmpDir)).toBe(true);
		});

		it("returns false when .session/ does not exist", () => {
			expect(ProjectDetector.hasExistingSession(tmpDir)).toBe(false);
		});
	});

	describe("getProjectType", () => {
		it("detects vite project", () => {
			fs.writeFileSync(path.join(tmpDir, "vite.config.ts"), "export default {}");
			expect(ProjectDetector.getProjectType(tmpDir)).toBe("vite");
		});

		it("detects next.js project", () => {
			fs.writeFileSync(path.join(tmpDir, "next.config.js"), "module.exports = {}");
			expect(ProjectDetector.getProjectType(tmpDir)).toBe("next");
		});

		it("detects node project from package.json", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			expect(ProjectDetector.getProjectType(tmpDir)).toBe("node");
		});

		it("returns unknown for empty directory", () => {
			expect(ProjectDetector.getProjectType(tmpDir)).toBe("unknown");
		});

		it("vite takes priority over next", () => {
			fs.writeFileSync(path.join(tmpDir, "vite.config.ts"), "");
			fs.writeFileSync(path.join(tmpDir, "next.config.js"), "");
			expect(ProjectDetector.getProjectType(tmpDir)).toBe("vite");
		});
	});
});
