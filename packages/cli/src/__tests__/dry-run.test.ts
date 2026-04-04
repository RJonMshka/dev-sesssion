import { describe, expect, it, vi } from "vitest";
import { dryRunGitignorePatch, dryRunMkdir, dryRunWrite } from "../utils/dry-run.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
	log: {
		info: vi.fn(),
		message: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		success: vi.fn(),
		step: vi.fn(),
	},
}));

describe("dry-run utilities", () => {
	describe("dryRunWrite", () => {
		it("logs file write details", async () => {
			const { log } = await import("@clack/prompts");
			dryRunWrite("/project/.session/STATE.md", "hello\nworld\n", "/project");

			expect(log.info).toHaveBeenCalledWith(
				expect.stringContaining("[dry-run] Would write: .session/STATE.md"),
			);
			expect(log.info).toHaveBeenCalledWith(expect.stringContaining("3 lines"));
		});

		it("includes byte count", async () => {
			const { log } = await import("@clack/prompts");
			dryRunWrite("/project/test.md", "abc", "/project");

			expect(log.info).toHaveBeenCalledWith(expect.stringContaining("3 bytes"));
		});
	});

	describe("dryRunMkdir", () => {
		it("logs directory creation", async () => {
			const { log } = await import("@clack/prompts");
			dryRunMkdir("/project/.session", "/project");

			expect(log.info).toHaveBeenCalledWith("[dry-run] Would create directory: .session");
		});
	});

	describe("dryRunGitignorePatch", () => {
		it("logs gitignore entries", async () => {
			const { log } = await import("@clack/prompts");
			dryRunGitignorePatch(
				"/project/.gitignore",
				[".session/SESSION_STATE.md", ".session/NEXT_PROMPT.md"],
				"/project",
			);

			expect(log.info).toHaveBeenCalledWith(
				expect.stringContaining("[dry-run] Would append to .gitignore"),
			);
			expect(log.message).toHaveBeenCalledWith("  .session/SESSION_STATE.md");
			expect(log.message).toHaveBeenCalledWith("  .session/NEXT_PROMPT.md");
		});
	});
});
