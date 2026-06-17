/**
 * Tests for the Windsurf adapter lifecycle hooks.
 *
 * @module
 */

import type {
	AdapterReadFile,
	AdapterSetupContext,
	AdapterWriteFile,
	SessionLifecycleContext,
	TransformStateContext,
} from "@dev-session/core";
import { describe, expect, it } from "vitest";
import {
	generateSessionSection,
	SECTION_END,
	SECTION_START,
	upsertSection,
	WINDSURFRULES_PATH,
	WindsurfAdapter,
} from "../windsurf-adapter.js";
import { makeBudget, makeChunk, makeState } from "./test-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWriteFile(): {
	fn: AdapterWriteFile;
	calls: Array<{ path: string; content: string }>;
} {
	const calls: Array<{ path: string; content: string }> = [];
	const fn: AdapterWriteFile = (path, content) => {
		calls.push({ path, content });
	};
	return { fn, calls };
}

function makeReadFile(files: Record<string, string>): AdapterReadFile {
	return (relativePath: string) => files[relativePath];
}

function makeSetupContext(
	readFiles?: Record<string, string>,
): AdapterSetupContext & { writeCalls: Array<{ path: string; content: string }> } {
	const writer = makeWriteFile();
	return {
		projectRoot: "/tmp/test",
		sessionDir: "/tmp/test/.session",
		projectInfo: {
			tool: "windsurf" as const,
			project_type: "node" as const,
			existing_files: [".windsurfrules", "package.json"],
			project_root: "/tmp/test",
			has_existing_session: false,
			project_name: "my-app",
		},
		isReinit: false,
		writeFile: writer.fn,
		readFile: makeReadFile(readFiles ?? {}),
		writeCalls: writer.calls,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WindsurfAdapter", () => {
	describe("config", () => {
		it("has correct metadata", () => {
			expect(WindsurfAdapter.config.name).toBe("windsurf");
			expect(WindsurfAdapter.config.display_name).toBe("Windsurf");
			expect(WindsurfAdapter.config.detect_files).toContain(".windsurfrules");
			expect(WindsurfAdapter.config.detect_files).toContain(".windsurf");
			expect(WindsurfAdapter.config.output_files).toContain(".windsurfrules");
		});

		it("uses WindsurfBootstrapFormatter", () => {
			expect(WindsurfAdapter.formatter.name).toBe("windsurf");
		});
	});

	describe("setup", () => {
		it("creates .windsurfrules with dev-session section", async () => {
			const ctx = makeSetupContext();
			const result = await WindsurfAdapter.setup?.(ctx);

			expect(result.filesWritten).toEqual([WINDSURFRULES_PATH]);
			expect(result.summary).toContain("Created");
			expect(ctx.writeCalls).toHaveLength(1);
			expect(ctx.writeCalls[0]?.path).toBe(WINDSURFRULES_PATH);
			expect(ctx.writeCalls[0]?.content).toContain(SECTION_START);
			expect(ctx.writeCalls[0]?.content).toContain("Ignore");
		});

		it("updates existing .windsurfrules", async () => {
			const existing = "# Rules\n\nExisting rules.\n";
			const ctx = makeSetupContext({ [WINDSURFRULES_PATH]: existing });
			const result = await WindsurfAdapter.setup?.(ctx);

			expect(result.summary).toContain("Updated");
			expect(ctx.writeCalls[0]?.content).toContain("# Rules");
			expect(ctx.writeCalls[0]?.content).toContain("Existing rules.");
		});

		it("replaces existing section between markers", async () => {
			const existing = `# Rules\n\n${SECTION_START}\nold\n${SECTION_END}\n\nOther\n`;
			const ctx = makeSetupContext({ [WINDSURFRULES_PATH]: existing });
			await WindsurfAdapter.setup?.(ctx);

			const written = ctx.writeCalls[0]?.content;
			expect(written).not.toContain("old");
			expect(written).toContain("Other");
			expect(written.split(SECTION_START).length).toBe(2);
		});
	});

	describe("transformState", () => {
		it("returns state unchanged (no-op)", () => {
			const state = makeState();
			const context: TransformStateContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				readFile: makeReadFile({}),
			};

			const result = WindsurfAdapter.transformState?.(state, context);
			expect(result).toBe(state);
		});
	});

	describe("onSessionStart", () => {
		it("resolves without error (no-op)", async () => {
			const context: SessionLifecycleContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				state: makeState(),
				chunk: makeChunk(),
				chunkFiles: [],
				budget: makeBudget(),
				writeFile: makeWriteFile().fn,
				readFile: makeReadFile({}),
			};

			await expect(WindsurfAdapter.onSessionStart?.(context)).resolves.toBeUndefined();
		});
	});

	describe("onSessionEnd", () => {
		it("updates .windsurfrules when it exists", async () => {
			const writer = makeWriteFile();
			const existing = `# Rules\n\n${SECTION_START}\nold\n${SECTION_END}\n`;

			const context: SessionLifecycleContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				state: makeState(),
				chunk: makeChunk(),
				chunkFiles: [],
				budget: makeBudget(),
				writeFile: writer.fn,
				readFile: makeReadFile({ [WINDSURFRULES_PATH]: existing }),
			};

			await WindsurfAdapter.onSessionEnd?.(context);
			expect(writer.calls).toHaveLength(1);
			expect(writer.calls[0]?.content).not.toContain("old");
		});

		it("does nothing when .windsurfrules does not exist", async () => {
			const writer = makeWriteFile();

			const context: SessionLifecycleContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				state: makeState(),
				chunk: makeChunk(),
				chunkFiles: [],
				budget: makeBudget(),
				writeFile: writer.fn,
				readFile: makeReadFile({}),
			};

			await WindsurfAdapter.onSessionEnd?.(context);
			expect(writer.calls).toHaveLength(0);
		});
	});
});

describe("generateSessionSection", () => {
	it("includes Ignore directive", () => {
		const section = generateSessionSection("my-app", ".session");
		expect(section).toContain("Ignore");
		expect(section).toContain("DONE_LOG.md");
	});
});

describe("upsertSection", () => {
	it("uses comment-style markers", () => {
		const result = upsertSection("", "content");
		expect(result).toContain(SECTION_START);
		expect(result).toContain(SECTION_END);
		// Windsurf uses # prefix, not HTML comments
		expect(SECTION_START).toMatch(/^#/);
	});
});
