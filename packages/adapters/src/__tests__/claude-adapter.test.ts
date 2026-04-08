/**
 * Tests for the Claude Code adapter lifecycle hooks.
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
	ClaudeAdapter,
	extractMemorySummaries,
	generateSessionSection,
	MEMORY_PATH,
	SECTION_END,
	SECTION_START,
	upsertSection,
} from "../claude-adapter.js";
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
	overrides?: Partial<AdapterSetupContext>,
): AdapterSetupContext & { writeCalls: Array<{ path: string; content: string }> } {
	const writer = makeWriteFile();
	const ctx = {
		projectRoot: "/tmp/test",
		sessionDir: "/tmp/test/.session",
		projectInfo: {
			tool: "claude" as const,
			project_type: "node" as const,
			existing_files: ["CLAUDE.md", "package.json"],
			project_root: "/tmp/test",
			has_existing_session: false,
			project_name: "my-app",
		},
		isReinit: false,
		writeFile: writer.fn,
		readFile: makeReadFile({}),
		writeCalls: writer.calls,
		...overrides,
	};
	return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeAdapter", () => {
	describe("config", () => {
		it("has correct metadata", () => {
			expect(ClaudeAdapter.config.name).toBe("claude");
			expect(ClaudeAdapter.config.display_name).toBe("Claude Code");
			expect(ClaudeAdapter.config.detect_files).toContain("CLAUDE.md");
			expect(ClaudeAdapter.config.detect_files).toContain(".claude");
			expect(ClaudeAdapter.config.output_files).toContain("CLAUDE.md");
			expect(ClaudeAdapter.config.config_version).toBe(1);
		});

		it("uses ClaudeBootstrapFormatter", () => {
			expect(ClaudeAdapter.formatter.name).toBe("claude");
		});
	});

	describe("setup", () => {
		it("creates CLAUDE.md with dev-session section when none exists", async () => {
			const ctx = makeSetupContext({ readFile: makeReadFile({}) });
			const result = await ClaudeAdapter.setup?.(ctx);

			expect(result.filesWritten).toEqual(["CLAUDE.md"]);
			expect(result.summary).toContain("Created");
			expect(ctx.writeCalls).toHaveLength(1);
			expect(ctx.writeCalls[0]?.path).toBe("CLAUDE.md");
			expect(ctx.writeCalls[0]?.content).toContain(SECTION_START);
			expect(ctx.writeCalls[0]?.content).toContain(SECTION_END);
			expect(ctx.writeCalls[0]?.content).toContain("dev-session");
		});

		it("updates existing CLAUDE.md preserving other content", async () => {
			const existing = "# My Project\n\nExisting content here.\n";
			const ctx = makeSetupContext({ readFile: makeReadFile({ "CLAUDE.md": existing }) });
			const result = await ClaudeAdapter.setup?.(ctx);

			expect(result.summary).toContain("Updated");
			expect(ctx.writeCalls[0]?.content).toContain("# My Project");
			expect(ctx.writeCalls[0]?.content).toContain("Existing content here.");
			expect(ctx.writeCalls[0]?.content).toContain(SECTION_START);
		});

		it("replaces existing dev-session section", async () => {
			const existing = `# Project\n\n${SECTION_START}\nold content\n${SECTION_END}\n\nOther stuff\n`;
			const ctx = makeSetupContext({ readFile: makeReadFile({ "CLAUDE.md": existing }) });
			await ClaudeAdapter.setup?.(ctx);

			const written = ctx.writeCalls[0]?.content;
			expect(written).toContain("# Project");
			expect(written).toContain("Other stuff");
			expect(written).not.toContain("old content");
			expect(written).toContain("dev-session");
			// Only one pair of markers
			expect(written.split(SECTION_START).length).toBe(2);
		});

		it("uses project name from project info", async () => {
			const ctx = makeSetupContext();
			await ClaudeAdapter.setup?.(ctx);

			const written = ctx.writeCalls[0]?.content;
			expect(written).toContain(".session");
		});
	});

	describe("transformState", () => {
		it("returns state unchanged when no MEMORY.md exists", () => {
			const state = makeState();
			const context: TransformStateContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				readFile: makeReadFile({}),
			};

			const result = ClaudeAdapter.transformState?.(state, context);
			expect(result).toEqual(state);
		});

		it("injects memory summaries as [memory] notes", () => {
			const state = makeState({ notes: ["Existing note"] });
			const memoryContent = [
				"# MEMORY",
				"",
				"- [Auth flow](auth.md) — JWT token validation approach",
				"- [DB schema](db.md) — PostgreSQL migration strategy",
				"",
			].join("\n");

			const context: TransformStateContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				readFile: makeReadFile({ [MEMORY_PATH]: memoryContent }),
			};

			const result = ClaudeAdapter.transformState?.(state, context);
			expect(result.notes).toHaveLength(3);
			expect(result.notes[0]).toBe("Existing note");
			expect(result.notes[1]).toContain("[memory]");
			expect(result.notes[1]).toContain("Auth flow");
			expect(result.notes[2]).toContain("[memory]");
		});

		it("does not duplicate memory notes on repeated calls", () => {
			const state = makeState({ notes: ["[memory] Already injected"] });
			const memoryContent = "- [Foo](foo.md) — bar\n";

			const context: TransformStateContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				readFile: makeReadFile({ [MEMORY_PATH]: memoryContent }),
			};

			const result = ClaudeAdapter.transformState?.(state, context);
			expect(result.notes).toHaveLength(1);
			expect(result.notes[0]).toBe("[memory] Already injected");
		});

		it("limits memory notes to 5", () => {
			const state = makeState({ notes: [] });
			const lines = Array.from(
				{ length: 10 },
				(_, i) => `- [Item ${String(i)}](i${String(i)}.md) — desc`,
			).join("\n");

			const context: TransformStateContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				readFile: makeReadFile({ [MEMORY_PATH]: lines }),
			};

			const result = ClaudeAdapter.transformState?.(state, context);
			const memoryNotes = result.notes.filter((n) => n.startsWith("[memory]"));
			expect(memoryNotes).toHaveLength(5);
		});

		it("does not mutate original state", () => {
			const state = makeState({ notes: [] });
			const memoryContent = "- [Foo](foo.md) — bar\n";

			const context: TransformStateContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				readFile: makeReadFile({ [MEMORY_PATH]: memoryContent }),
			};

			ClaudeAdapter.transformState?.(state, context);
			expect(state.notes).toHaveLength(0);
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

			await expect(ClaudeAdapter.onSessionStart?.(context)).resolves.toBeUndefined();
		});
	});

	describe("onSessionEnd", () => {
		it("updates CLAUDE.md when it exists", async () => {
			const writer = makeWriteFile();
			const existing = `# Project\n\n${SECTION_START}\nold\n${SECTION_END}\n`;

			const context: SessionLifecycleContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				state: makeState(),
				chunk: makeChunk(),
				chunkFiles: [],
				budget: makeBudget(),
				writeFile: writer.fn,
				readFile: makeReadFile({ "CLAUDE.md": existing }),
			};

			await ClaudeAdapter.onSessionEnd?.(context);
			expect(writer.calls).toHaveLength(1);
			expect(writer.calls[0]?.content).toContain(SECTION_START);
			expect(writer.calls[0]?.content).not.toContain("old");
		});

		it("does nothing when CLAUDE.md does not exist", async () => {
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

			await ClaudeAdapter.onSessionEnd?.(context);
			expect(writer.calls).toHaveLength(0);
		});
	});
});

describe("generateSessionSection", () => {
	it("includes session workflow instructions", () => {
		const section = generateSessionSection("my-app", ".session");
		expect(section).toContain("dev-session");
		expect(section).toContain("SESSION_STATE.md");
		expect(section).toContain("FILE_INDEX.md");
		expect(section).toContain("NEXT_PROMPT.md");
		expect(section).toContain("ROUTINES.md");
	});
});

describe("upsertSection", () => {
	it("appends to empty content", () => {
		const result = upsertSection("", "new section");
		expect(result).toContain(SECTION_START);
		expect(result).toContain("new section");
		expect(result).toContain(SECTION_END);
	});

	it("appends to existing content", () => {
		const result = upsertSection("# Existing\n", "new section");
		expect(result).toContain("# Existing");
		expect(result).toContain("new section");
	});

	it("replaces between markers", () => {
		const existing = `before\n${SECTION_START}\nold\n${SECTION_END}\nafter`;
		const result = upsertSection(existing, "new");
		expect(result).toContain("before");
		expect(result).toContain("after");
		expect(result).toContain("new");
		expect(result).not.toContain("old");
	});
});

describe("extractMemorySummaries", () => {
	it("extracts list items from MEMORY.md", () => {
		const content =
			"# Memory\n\n- [Auth](auth.md) — JWT approach\n- [DB](db.md) — schema\n\nSome text\n";
		const summaries = extractMemorySummaries(content);
		expect(summaries).toHaveLength(2);
		expect(summaries[0]).toContain("Auth");
		expect(summaries[1]).toContain("DB");
	});

	it("returns empty array for no list items", () => {
		const summaries = extractMemorySummaries("# Empty\n\nNo items.\n");
		expect(summaries).toHaveLength(0);
	});

	it("respects 200-line limit", () => {
		const lines = Array.from({ length: 300 }, (_, i) => `- Item ${String(i)}`).join("\n");
		const summaries = extractMemorySummaries(lines);
		expect(summaries).toHaveLength(200);
	});
});
