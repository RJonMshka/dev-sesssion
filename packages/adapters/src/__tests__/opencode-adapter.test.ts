/**
 * Tests for the opencode adapter lifecycle hooks.
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
	OpencodeAdapter,
	SECTION_END,
	SECTION_START,
	upsertSection,
} from "../opencode-adapter.js";
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
			tool: "opencode" as const,
			project_type: "node" as const,
			existing_files: ["AGENTS.md", "package.json"],
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

describe("OpencodeAdapter", () => {
	describe("config", () => {
		it("has correct metadata", () => {
			expect(OpencodeAdapter.config.name).toBe("opencode");
			expect(OpencodeAdapter.config.display_name).toBe("opencode");
			expect(OpencodeAdapter.config.detect_files).toContain("AGENTS.md");
			expect(OpencodeAdapter.config.detect_files).toContain("opencode.json");
			expect(OpencodeAdapter.config.output_files).toContain("AGENTS.md");
		});

		it("uses OpencodeBootstrapFormatter", () => {
			expect(OpencodeAdapter.formatter.name).toBe("opencode");
		});
	});

	describe("setup", () => {
		it("creates AGENTS.md with dev-session section", async () => {
			const ctx = makeSetupContext();
			const result = await OpencodeAdapter.setup?.(ctx);

			expect(result.filesWritten).toEqual(["AGENTS.md"]);
			expect(result.summary).toContain("Created");
			expect(ctx.writeCalls).toHaveLength(1);
			expect(ctx.writeCalls[0]?.path).toBe("AGENTS.md");
			expect(ctx.writeCalls[0]?.content).toContain(SECTION_START);
			expect(ctx.writeCalls[0]?.content).toContain("Exclude");
		});

		it("updates existing AGENTS.md", async () => {
			const existing = "# Agents\n\nExisting rules.\n";
			const ctx = makeSetupContext({ "AGENTS.md": existing });
			const result = await OpencodeAdapter.setup?.(ctx);

			expect(result.summary).toContain("Updated");
			expect(ctx.writeCalls[0]?.content).toContain("# Agents");
			expect(ctx.writeCalls[0]?.content).toContain("Existing rules.");
		});

		it("replaces existing section between markers", async () => {
			const existing = `# Agents\n\n${SECTION_START}\nold\n${SECTION_END}\n\nOther rules\n`;
			const ctx = makeSetupContext({ "AGENTS.md": existing });
			await OpencodeAdapter.setup?.(ctx);

			const written = ctx.writeCalls[0]?.content;
			expect(written).not.toContain("old");
			expect(written).toContain("Other rules");
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

			const result = OpencodeAdapter.transformState?.(state, context);
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

			await expect(OpencodeAdapter.onSessionStart?.(context)).resolves.toBeUndefined();
		});
	});

	describe("onSessionEnd", () => {
		it("updates AGENTS.md when it exists", async () => {
			const writer = makeWriteFile();
			const existing = `# Agents\n\n${SECTION_START}\nold\n${SECTION_END}\n`;

			const context: SessionLifecycleContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				state: makeState(),
				chunk: makeChunk(),
				chunkFiles: [],
				budget: makeBudget(),
				writeFile: writer.fn,
				readFile: makeReadFile({ "AGENTS.md": existing }),
			};

			await OpencodeAdapter.onSessionEnd?.(context);
			expect(writer.calls).toHaveLength(1);
			expect(writer.calls[0]?.content).not.toContain("old");
		});

		it("does nothing when AGENTS.md does not exist", async () => {
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

			await OpencodeAdapter.onSessionEnd?.(context);
			expect(writer.calls).toHaveLength(0);
		});
	});
});

describe("generateSessionSection", () => {
	it("includes Exclude directive", () => {
		const section = generateSessionSection("my-app", ".session");
		expect(section).toContain("Exclude");
		expect(section).toContain("DONE_LOG.md");
	});
});

describe("upsertSection", () => {
	it("appends to empty content", () => {
		const result = upsertSection("", "content");
		expect(result).toContain(SECTION_START);
		expect(result).toContain("content");
		expect(result).toContain(SECTION_END);
	});

	it("replaces between markers", () => {
		const existing = `before\n${SECTION_START}\nold\n${SECTION_END}\nafter`;
		const result = upsertSection(existing, "new");
		expect(result).toContain("before");
		expect(result).toContain("after");
		expect(result).not.toContain("old");
	});
});
