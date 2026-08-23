import { describe, expect, it } from "vitest";
import type { GitReader } from "../git/git-reader.js";
import type { FileIndexEntry, PlanChunk, SessionState } from "../schemas/index.js";
import { SessionVerifier } from "../verifiers/session-verifier.js";

/**
 * Builds a fake GitReader over an in-memory repository state.
 *
 * @param opts - The repository state to serve.
 * @returns An object satisfying the GitReader contract.
 */
function fakeReader(opts: {
	isRepo?: boolean;
	dirty?: string[];
	history?: Array<{ sha: string; date: string; subject: string }>;
	changed?: string[];
}): typeof GitReader {
	return {
		isRepo: async () => opts.isRepo ?? true,
		isTracked: async () => true,
		dirtyFiles: async () => opts.dirty ?? [],
		commitsTouching: async () =>
			opts.history ?? [{ sha: "abc", date: "2026-08-01T00:00:00Z", subject: "work" }],
		fileAtRev: async () => null,
		changedBetween: async () => opts.changed ?? [],
	} as unknown as typeof GitReader;
}

function makeState(overrides: Partial<SessionState> = {}): SessionState {
	return {
		active_chunk: 1,
		session_id: "verify-test",
		last_updated: "2026-08-01",
		tasks: [],
		notes: [],
		last_worked_files: [],
		completed_chunks: {},
		max_prompt_lines: 20,
		...overrides,
	};
}

function makeChunk(overrides: Partial<PlanChunk> = {}): PlanChunk {
	return {
		chunk_id: 1,
		title: "Test chunk",
		tasks: [],
		depends_on: [],
		estimated_sessions: 1,
		...overrides,
	} as PlanChunk;
}

function entry(filepath: string): FileIndexEntry {
	return { filepath, chunk: 1, layer: 1, token_cost: 10 } as FileIndexEntry;
}

const base = { cwd: "/repo", entries: [] as FileIndexEntry[] };

describe("SessionVerifier", () => {
	it("degrades to a single finding outside a git repository", async () => {
		const report = await SessionVerifier.verify(
			{ ...base, state: makeState(), chunk: makeChunk() },
			fakeReader({ isRepo: false }),
		);
		expect(report.gitAvailable).toBe(false);
		expect(report.findings[0]?.code).toBe("NOT_A_REPO");
	});

	it("flags last_worked_files with no git evidence", async () => {
		const report = await SessionVerifier.verify(
			{ ...base, state: makeState({ last_worked_files: ["src/ghost.ts"] }), chunk: makeChunk() },
			fakeReader({ changed: ["src/real.ts"] }),
		);
		const codes = report.findings.map((f) => f.code);
		expect(codes).toContain("UNBACKED_WORKED_FILE");
		expect(report.findings.find((f) => f.code === "UNBACKED_WORKED_FILE")?.message).toContain(
			"src/ghost.ts",
		);
	});

	it("accepts a claimed file backed by a commit", async () => {
		const report = await SessionVerifier.verify(
			{ ...base, state: makeState({ last_worked_files: ["src/real.ts"] }), chunk: makeChunk() },
			fakeReader({ changed: ["src/real.ts"] }),
		);
		expect(report.findings.map((f) => f.code)).not.toContain("UNBACKED_WORKED_FILE");
	});

	it("accepts a claimed file backed only by an uncommitted change", async () => {
		const report = await SessionVerifier.verify(
			{ ...base, state: makeState({ last_worked_files: ["src/wip.ts"] }), chunk: makeChunk() },
			fakeReader({ dirty: ["src/wip.ts"], changed: [] }),
		);
		expect(report.findings.map((f) => f.code)).not.toContain("UNBACKED_WORKED_FILE");
	});

	it("flags modified files missing from FILE_INDEX", async () => {
		const report = await SessionVerifier.verify(
			{
				cwd: "/repo",
				entries: [entry("src/known.ts")],
				state: makeState(),
				chunk: makeChunk(),
			},
			fakeReader({ dirty: ["src/known.ts", "src/unknown.ts"] }),
		);
		const finding = report.findings.find((f) => f.code === "UNINDEXED_CHANGE");
		expect(finding?.message).toContain("src/unknown.ts");
		expect(finding?.message).not.toContain("src/known.ts");
	});

	it("errors when tasks are done with no supporting work at all", async () => {
		const report = await SessionVerifier.verify(
			{
				...base,
				state: makeState(),
				chunk: makeChunk({ tasks: [{ text: "Ship it", status: "done" }] }),
			},
			fakeReader({ dirty: [], changed: [], history: [] }),
		);
		expect(report.errorCount).toBe(1);
		expect(report.findings[0]?.code).toBe("DONE_WITHOUT_EVIDENCE");
	});

	it("does not error when done tasks have commits behind them", async () => {
		const report = await SessionVerifier.verify(
			{
				...base,
				state: makeState(),
				chunk: makeChunk({ tasks: [{ text: "Ship it", status: "done" }] }),
			},
			fakeReader({ changed: ["src/shipped.ts"] }),
		);
		expect(report.errorCount).toBe(0);
	});

	it("notes uncommitted session files", async () => {
		const report = await SessionVerifier.verify(
			{ ...base, state: makeState(), chunk: makeChunk() },
			fakeReader({ dirty: [".session/SESSION_STATE.md"], changed: ["src/a.ts"] }),
		);
		expect(report.findings.map((f) => f.code)).toContain("UNCOMMITTED_SESSION");
	});

	it("orders findings with errors first", async () => {
		const report = await SessionVerifier.verify(
			{
				...base,
				state: makeState({ last_worked_files: ["src/ghost.ts"] }),
				chunk: makeChunk({ tasks: [{ text: "Ship it", status: "done" }] }),
			},
			fakeReader({ dirty: [], changed: [], history: [] }),
		);
		expect(report.findings[0]?.severity).toBe("error");
	});
});
