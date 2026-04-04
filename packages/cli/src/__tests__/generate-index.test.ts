import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PlanChunk } from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { PathValidator } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateIndex } from "../commands/generate-index.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
	select: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn(() => false),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
	},
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
	})),
}));

let tmpDir: string;
let sessionDir: ValidatedPath;

const SAMPLE_CHUNKS: PlanChunk[] = [
	{
		chunk_id: 1,
		title: "Foundation",
		depends_on: [],
		tasks: [{ text: "Setup", status: "todo" }],
	},
	{
		chunk_id: 2,
		title: "Core",
		depends_on: [1],
		tasks: [{ text: "Build", status: "todo" }],
	},
];

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-index-test-"));
	const sessionPath = path.join(tmpDir, ".session");
	fs.mkdirSync(sessionPath);
	sessionDir = PathValidator.safeResolvePath(".session", tmpDir);

	// Create some sample files for walking
	fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export {};\n");
	fs.writeFileSync(path.join(tmpDir, "src", "app.ts"), "console.log('hello');\n");
	fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"test"}\n');
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateIndex", () => {
	it("generates index with --yes mode", async () => {
		const result = await generateIndex(sessionDir, SAMPLE_CHUNKS, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		expect(result.fileCount).toBeGreaterThan(0);
		expect(result.entries.length).toBeGreaterThan(0);

		// All non-always-include entries should be tagged to chunk 1
		const chunkEntries = result.entries.filter((e) => !e.chunk_tags.includes(0));
		for (const entry of chunkEntries) {
			expect(entry.chunk_tags).toContain(1);
		}
	});

	it("writes FILE_INDEX.md in non-dry-run mode", async () => {
		await generateIndex(sessionDir, SAMPLE_CHUNKS, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		expect(fs.existsSync(path.join(sessionDir, "FILE_INDEX.md"))).toBe(true);
	});

	it("dry-run mode writes no files", async () => {
		const result = await generateIndex(sessionDir, SAMPLE_CHUNKS, {
			yes: true,
			dryRun: true,
			verbose: false,
			cwd: tmpDir,
		});

		expect(result.entries.length).toBeGreaterThan(0);
		expect(fs.existsSync(path.join(sessionDir, "FILE_INDEX.md"))).toBe(false);
	});

	it("entries have token_cost populated", async () => {
		const result = await generateIndex(sessionDir, SAMPLE_CHUNKS, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		const chunkEntries = result.entries.filter((e) => !e.chunk_tags.includes(0));
		for (const entry of chunkEntries) {
			expect(entry.token_cost).toBeDefined();
			expect(entry.token_cost).toBeGreaterThanOrEqual(0);
		}
	});

	it("entries have purpose inferred", async () => {
		const result = await generateIndex(sessionDir, SAMPLE_CHUNKS, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		const pkgEntry = result.entries.find((e) => e.filepath === "package.json");
		expect(pkgEntry?.purpose).toBe("Package manifest");

		const tsEntry = result.entries.find((e) => e.filepath.endsWith("index.ts"));
		if (tsEntry) {
			expect(tsEntry.purpose).toContain("entry point");
		}
	});

	it("handles empty codebase", async () => {
		// Create a completely empty temp dir
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-test-"));
		const emptySession = path.join(emptyDir, ".session");
		fs.mkdirSync(emptySession);
		const emptySessionDir = PathValidator.safeResolvePath(".session", emptyDir);

		try {
			const result = await generateIndex(emptySessionDir, SAMPLE_CHUNKS, {
				yes: true,
				dryRun: false,
				verbose: false,
				cwd: emptyDir,
			});

			// Should at minimum have zero chunk-tagged entries
			expect(result.fileCount).toBe(0);
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});
