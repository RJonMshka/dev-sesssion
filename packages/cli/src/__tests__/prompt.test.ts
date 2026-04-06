import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPrompt } from "../commands/prompt.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setupSession(promptContent: string): void {
	const sessionDir = path.join(tmpDir, ".session");
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(path.join(sessionDir, "NEXT_PROMPT.md"), promptContent);
}

describe("runPrompt", () => {
	it("prints NEXT_PROMPT.md to stdout", async () => {
		const content = "Project: test\nActive chunk: 1\nLoad: src/index.ts\n";
		setupSession(content);

		const chunks: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((...args: unknown[]) => {
			const chunk = args[0];
			if (typeof chunk === "string") {
				chunks.push(chunk);
			}
			return true;
		});

		try {
			const result = await runPrompt({ cwd: tmpDir, copy: false });
			expect(result).toBe(content);
			expect(chunks.join("")).toBe(content);
		} finally {
			writeSpy.mockRestore();
		}
	});

	it("returns the prompt content", async () => {
		const content = "Some prompt content\n";
		setupSession(content);

		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		try {
			const result = await runPrompt({ cwd: tmpDir, copy: false });
			expect(result).toBe(content);
		} finally {
			writeSpy.mockRestore();
		}
	});

	it("throws when no .session/ exists", async () => {
		await expect(runPrompt({ cwd: tmpDir, copy: false })).rejects.toThrow(
			"No .session/ directory found",
		);
	});

	it("throws when NEXT_PROMPT.md is missing", async () => {
		fs.mkdirSync(path.join(tmpDir, ".session"), { recursive: true });

		await expect(runPrompt({ cwd: tmpDir, copy: false })).rejects.toThrow(
			"No NEXT_PROMPT.md found",
		);
	});

	it("handles empty prompt file", async () => {
		setupSession("");

		const chunks: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((...args: unknown[]) => {
			const chunk = args[0];
			if (typeof chunk === "string") {
				chunks.push(chunk);
			}
			return true;
		});

		try {
			const result = await runPrompt({ cwd: tmpDir, copy: false });
			expect(result).toBe("");
		} finally {
			writeSpy.mockRestore();
		}
	});
});
