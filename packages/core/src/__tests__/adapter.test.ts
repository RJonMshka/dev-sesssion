/**
 * Tests for the Adapter interface and related context types.
 *
 * Since Adapter is a TypeScript interface (no runtime code), these tests verify:
 * 1. Types are exported correctly from @dev-session/core
 * 2. Objects satisfying the interface compile and behave correctly
 * 3. Optional hooks work — adapters with/without hooks are both valid
 * 4. Context objects satisfy their type contracts
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import type {
	Adapter,
	AdapterConfig,
	AdapterReadFile,
	AdapterSetupContext,
	AdapterSetupResult,
	AdapterWriteFile,
	PlanChunk,
	SessionLifecycleContext,
	SessionState,
	TransformStateContext,
} from "../index.js";
import { PlainTextFormatter } from "../index.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal adapter config for testing. */
const TEST_CONFIG: AdapterConfig = {
	name: "test",
	display_name: "Test Adapter",
	detect_files: ["TEST.md"],
	output_files: ["TEST.md"],
	config_version: 1,
};

/** A minimal adapter with no optional hooks. */
const MINIMAL_ADAPTER: Adapter = {
	config: TEST_CONFIG,
	formatter: PlainTextFormatter,
};

/** A full adapter with all lifecycle hooks implemented. */
const FULL_ADAPTER: Adapter = {
	config: TEST_CONFIG,
	formatter: PlainTextFormatter,

	async setup(_context: AdapterSetupContext): Promise<AdapterSetupResult> {
		return {
			filesWritten: ["TEST.md"],
			summary: "Created TEST.md",
		};
	},

	transformState(state: SessionState, _context: TransformStateContext): SessionState {
		return {
			...state,
			notes: [...state.notes, "Injected by test adapter"],
		};
	},

	async onSessionStart(_context: SessionLifecycleContext): Promise<void> {
		// Read tool-specific context
	},

	async onSessionEnd(_context: SessionLifecycleContext): Promise<void> {
		// Write tool-specific updates
	},
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** No-op write file for test contexts. */
const noopWriteFile: AdapterWriteFile = () => {};

/** No-op read file for test contexts. */
const noopReadFile: AdapterReadFile = () => undefined;

/** Creates a minimal SessionState for type-checking contexts. */
function makeTestState(): SessionState {
	return {
		active_chunk: 1,
		session_id: "test",
		last_updated: "2026-04-06",
		tasks: [],
		notes: [],
		last_worked_files: [],
		completed_chunks: {},
	};
}

/** Creates a minimal PlanChunk for type-checking contexts. */
function makeTestChunk(): PlanChunk {
	return {
		chunk_id: 1,
		title: "Test chunk",
		depends_on: [],
		tasks: [{ text: "Task 1", status: "todo" }],
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Adapter interface", () => {
	describe("minimal adapter (no optional hooks)", () => {
		it("has config and formatter", () => {
			expect(MINIMAL_ADAPTER.config.name).toBe("test");
			expect(MINIMAL_ADAPTER.formatter.name).toBe("plain");
		});

		it("has no lifecycle hooks", () => {
			expect(MINIMAL_ADAPTER.setup).toBeUndefined();
			expect(MINIMAL_ADAPTER.transformState).toBeUndefined();
			expect(MINIMAL_ADAPTER.onSessionStart).toBeUndefined();
			expect(MINIMAL_ADAPTER.onSessionEnd).toBeUndefined();
		});
	});

	describe("full adapter (all hooks)", () => {
		it("has config and formatter", () => {
			expect(FULL_ADAPTER.config.name).toBe("test");
			expect(FULL_ADAPTER.formatter.name).toBe("plain");
		});

		it("has all lifecycle hooks defined", () => {
			expect(typeof FULL_ADAPTER.setup).toBe("function");
			expect(typeof FULL_ADAPTER.transformState).toBe("function");
			expect(typeof FULL_ADAPTER.onSessionStart).toBe("function");
			expect(typeof FULL_ADAPTER.onSessionEnd).toBe("function");
		});

		it("setup returns AdapterSetupResult", async () => {
			const context: AdapterSetupContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				projectInfo: {
					tool: "unknown",
					project_type: "node",
					existing_files: ["package.json"],
					project_root: "/tmp/test",
					has_existing_session: false,
				},
				isReinit: false,
				writeFile: noopWriteFile,
				readFile: noopReadFile,
			};

			const result = await FULL_ADAPTER.setup?.(context);
			expect(result.filesWritten).toEqual(["TEST.md"]);
			expect(result.summary).toBe("Created TEST.md");
		});

		it("transformState returns modified state", () => {
			const state = makeTestState();
			const context: TransformStateContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				readFile: noopReadFile,
			};

			const result = FULL_ADAPTER.transformState?.(state, context);
			expect(result.notes).toContain("Injected by test adapter");
			// Original state unchanged (immutable transform)
			expect(state.notes).toHaveLength(0);
		});

		it("onSessionStart resolves without error", async () => {
			const context: SessionLifecycleContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				state: makeTestState(),
				chunk: makeTestChunk(),
				chunkFiles: [],
				budget: {
					totalTokens: 500,
					breakdown: {
						sessionState: 100,
						planChunk: 200,
						files: new Map(),
						alwaysInclude: 50,
					},
					overBudget: false,
					budgetCap: 4000,
					accurate: false,
				},
				writeFile: noopWriteFile,
				readFile: noopReadFile,
			};

			await expect(FULL_ADAPTER.onSessionStart?.(context)).resolves.toBeUndefined();
		});

		it("onSessionEnd resolves without error", async () => {
			const context: SessionLifecycleContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				state: makeTestState(),
				chunk: makeTestChunk(),
				chunkFiles: [],
				budget: {
					totalTokens: 500,
					breakdown: {
						sessionState: 100,
						planChunk: 200,
						files: new Map(),
						alwaysInclude: 50,
					},
					overBudget: false,
					budgetCap: 4000,
					accurate: false,
				},
				writeFile: noopWriteFile,
				readFile: noopReadFile,
			};

			await expect(FULL_ADAPTER.onSessionEnd?.(context)).resolves.toBeUndefined();
		});
	});

	describe("selective hooks adapter", () => {
		it("allows adapter with only setup hook", () => {
			const adapter: Adapter = {
				config: TEST_CONFIG,
				formatter: PlainTextFormatter,
				async setup() {
					return { filesWritten: [], summary: "No-op" };
				},
			};

			expect(typeof adapter.setup).toBe("function");
			expect(adapter.transformState).toBeUndefined();
			expect(adapter.onSessionStart).toBeUndefined();
			expect(adapter.onSessionEnd).toBeUndefined();
		});

		it("allows adapter with only transformState hook", () => {
			const adapter: Adapter = {
				config: TEST_CONFIG,
				formatter: PlainTextFormatter,
				transformState(state) {
					return state;
				},
			};

			expect(typeof adapter.transformState).toBe("function");
			expect(adapter.setup).toBeUndefined();
		});

		it("allows adapter with only session lifecycle hooks", () => {
			const adapter: Adapter = {
				config: TEST_CONFIG,
				formatter: PlainTextFormatter,
				async onSessionStart() {
					// no-op
				},
				async onSessionEnd() {
					// no-op
				},
			};

			expect(typeof adapter.onSessionStart).toBe("function");
			expect(typeof adapter.onSessionEnd).toBe("function");
			expect(adapter.setup).toBeUndefined();
			expect(adapter.transformState).toBeUndefined();
		});
	});

	describe("AdapterSetupContext", () => {
		it("carries project info and reinit flag", () => {
			const context: AdapterSetupContext = {
				projectRoot: "/home/user/project",
				sessionDir: "/home/user/project/.session",
				projectInfo: {
					tool: "claude",
					project_type: "vite",
					existing_files: ["CLAUDE.md", "package.json"],
					project_root: "/home/user/project",
					has_existing_session: true,
					project_name: "my-app",
				},
				isReinit: true,
				writeFile: noopWriteFile,
				readFile: noopReadFile,
			};

			expect(context.isReinit).toBe(true);
			expect(context.projectInfo.tool).toBe("claude");
			expect(context.projectInfo.project_name).toBe("my-app");
		});
	});

	describe("SessionLifecycleContext", () => {
		it("carries state, chunk, files, and budget", () => {
			const context: SessionLifecycleContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				state: makeTestState(),
				chunk: makeTestChunk(),
				chunkFiles: [
					{ filepath: "src/index.ts", chunk_tags: [1], purpose: "Entry", token_cost: 50 },
				],
				budget: {
					totalTokens: 200,
					breakdown: {
						sessionState: 50,
						planChunk: 100,
						files: new Map([["src/index.ts", 50]]),
						alwaysInclude: 0,
					},
					overBudget: false,
					budgetCap: 4000,
					accurate: false,
				},
				writeFile: noopWriteFile,
				readFile: noopReadFile,
			};

			expect(context.chunkFiles).toHaveLength(1);
			expect(context.budget.totalTokens).toBe(200);
			expect(context.chunk.tasks).toHaveLength(1);
		});
	});

	describe("TransformStateContext", () => {
		it("provides paths and readFile (minimal for pure transforms)", () => {
			const context: TransformStateContext = {
				projectRoot: "/tmp/test",
				sessionDir: "/tmp/test/.session",
				readFile: noopReadFile,
			};

			expect(context.projectRoot).toBe("/tmp/test");
			expect(context.sessionDir).toBe("/tmp/test/.session");
		});
	});
});
