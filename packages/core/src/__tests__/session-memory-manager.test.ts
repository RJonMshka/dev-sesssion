/**
 * Unit tests for SessionMemoryManager.
 *
 * Uses real temp directories (same pattern as session-state-manager.test.ts).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { ParseError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionMemoryManager } from "../managers/session-memory-manager.js";
import type { ContextLogEntry } from "../schemas/context-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, ".tmp-mem-"));
}

function makeEntry(overrides: Partial<ContextLogEntry> = {}): ContextLogEntry {
	return {
		session_id: "chunk-1-foundation",
		timestamp: "2026-04-01T10:00:00.000Z",
		active_chunk: 1,
		files_loaded: ["CLAUDE.md", ".session/SESSION_STATE.md"],
		total_tokens: 1000,
		modifications: ["packages/core/src/index.ts"],
		...overrides,
	};
}

let tmpDir: string;
let sessionDir: ValidatedPath;

beforeEach(() => {
	tmpDir = makeTmpDir();
	sessionDir = tmpDir as ValidatedPath;
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

describe("SessionMemoryManager.load", () => {
	it("returns empty array when log does not exist", () => {
		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries).toEqual([]);
	});

	it("returns empty array for empty entries list", () => {
		fs.writeFileSync(path.join(tmpDir, "CONTEXT_LOG.md"), "entries: []\n");
		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries).toEqual([]);
	});

	it("parses valid entries from file", () => {
		const entry = makeEntry();
		const content = `entries: ${JSON.stringify([entry], null, 2)}\n`;
		fs.writeFileSync(path.join(tmpDir, "CONTEXT_LOG.md"), content);

		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject(entry);
	});

	it("parses multiple entries preserving order", () => {
		const e1 = makeEntry({ timestamp: "2026-04-01T10:00:00.000Z" });
		const e2 = makeEntry({ timestamp: "2026-04-02T10:00:00.000Z" });
		const content = `entries: ${JSON.stringify([e1, e2], null, 2)}\n`;
		fs.writeFileSync(path.join(tmpDir, "CONTEXT_LOG.md"), content);

		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries).toHaveLength(2);
		expect(entries[0]?.timestamp).toBe("2026-04-01T10:00:00.000Z");
		expect(entries[1]?.timestamp).toBe("2026-04-02T10:00:00.000Z");
	});
});

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

describe("SessionMemoryManager.append", () => {
	it("creates log file with first entry", () => {
		const entry = makeEntry();
		SessionMemoryManager.append(sessionDir, entry);

		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject(entry);
	});

	it("appends to existing entries", () => {
		const e1 = makeEntry({ timestamp: "2026-04-01T10:00:00.000Z" });
		const e2 = makeEntry({ timestamp: "2026-04-02T10:00:00.000Z" });

		SessionMemoryManager.append(sessionDir, e1);
		SessionMemoryManager.append(sessionDir, e2);

		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries).toHaveLength(2);
	});

	it("is idempotent on repeated calls with same session_id and timestamp", () => {
		const entry = makeEntry();
		SessionMemoryManager.append(sessionDir, entry);
		SessionMemoryManager.append(sessionDir, entry);
		SessionMemoryManager.append(sessionDir, entry);

		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries).toHaveLength(1);
	});

	it("allows same session_id with different timestamp", () => {
		const e1 = makeEntry({ timestamp: "2026-04-01T10:00:00.000Z" });
		const e2 = makeEntry({ timestamp: "2026-04-01T11:00:00.000Z" });

		SessionMemoryManager.append(sessionDir, e1);
		SessionMemoryManager.append(sessionDir, e2);

		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries).toHaveLength(2);
	});

	it("preserves order oldest-first", () => {
		const e1 = makeEntry({ timestamp: "2026-04-01T10:00:00.000Z" });
		const e2 = makeEntry({ timestamp: "2026-04-02T10:00:00.000Z" });
		const e3 = makeEntry({ timestamp: "2026-04-03T10:00:00.000Z" });

		SessionMemoryManager.append(sessionDir, e1);
		SessionMemoryManager.append(sessionDir, e2);
		SessionMemoryManager.append(sessionDir, e3);

		const entries = SessionMemoryManager.load(sessionDir);
		expect(entries[0]?.timestamp).toBe("2026-04-01T10:00:00.000Z");
		expect(entries[2]?.timestamp).toBe("2026-04-03T10:00:00.000Z");
	});
});

// ---------------------------------------------------------------------------
// summarizeStats
// ---------------------------------------------------------------------------

describe("SessionMemoryManager.summarizeStats", () => {
	it("returns zeroed stats for empty entries", () => {
		const stats = SessionMemoryManager.summarizeStats([]);
		expect(stats.totalSessions).toBe(0);
		expect(stats.firstDate).toBeNull();
		expect(stats.lastDate).toBeNull();
		expect(stats.avgTokens).toBe(0);
		expect(stats.topFiles).toHaveLength(0);
	});

	it("computes correct averages on fixture data", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				timestamp: "2026-04-01T10:00:00.000Z",
				total_tokens: 1000,
				files_loaded: ["a.ts", "b.ts"],
			}),
			makeEntry({
				timestamp: "2026-04-02T10:00:00.000Z",
				total_tokens: 2000,
				files_loaded: ["a.ts", "c.ts"],
			}),
			makeEntry({
				timestamp: "2026-04-03T10:00:00.000Z",
				total_tokens: 3000,
				files_loaded: ["a.ts"],
			}),
		];

		const stats = SessionMemoryManager.summarizeStats(entries);
		expect(stats.totalSessions).toBe(3);
		expect(stats.avgTokens).toBe(2000);
		expect(stats.firstDate).toBe("2026-04-01");
		expect(stats.lastDate).toBe("2026-04-03");
	});

	it("returns top files sorted by count descending", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({ files_loaded: ["a.ts", "b.ts", "c.ts"], timestamp: "2026-04-01T10:00:00.000Z" }),
			makeEntry({ files_loaded: ["a.ts", "b.ts", "d.ts"], timestamp: "2026-04-02T10:00:00.000Z" }),
			makeEntry({ files_loaded: ["a.ts", "e.ts", "f.ts"], timestamp: "2026-04-03T10:00:00.000Z" }),
		];

		const stats = SessionMemoryManager.summarizeStats(entries);
		expect(stats.topFiles[0]).toMatchObject({ path: "a.ts", count: 3 });
		expect(stats.topFiles[1]).toMatchObject({ path: "b.ts", count: 2 });
	});

	it("limits top files to 5", () => {
		const entries: ContextLogEntry[] = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"].map(
			(f, i) =>
				makeEntry({
					files_loaded: [f],
					timestamp: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
				}),
		);

		const stats = SessionMemoryManager.summarizeStats(entries);
		expect(stats.topFiles.length).toBeLessThanOrEqual(5);
	});

	it("single entry has avgTokens equal to its own total", () => {
		const stats = SessionMemoryManager.summarizeStats([makeEntry({ total_tokens: 1500 })]);
		expect(stats.avgTokens).toBe(1500);
		expect(stats.totalSessions).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// detectPassiveLoads
// ---------------------------------------------------------------------------

describe("SessionMemoryManager.detectPassiveLoads", () => {
	it("returns files in always-include with zero logged modifications", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				files_loaded: ["CLAUDE.md", "src/index.ts"],
				modifications: [],
				timestamp: "2026-04-01T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["CLAUDE.md", "src/index.ts"],
				modifications: [],
				timestamp: "2026-04-02T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["CLAUDE.md", "src/index.ts"],
				modifications: [],
				timestamp: "2026-04-03T10:00:00.000Z",
			}),
		];

		const reports = SessionMemoryManager.detectPassiveLoads(entries, ["CLAUDE.md"], 3);
		expect(reports).toHaveLength(1);
		expect(reports[0]?.path).toBe("CLAUDE.md");
		expect(reports[0]?.suggestion).toBe("remove-from-always-include");
	});

	it("does not flag files that were modified at least once", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				files_loaded: ["CLAUDE.md"],
				modifications: ["CLAUDE.md"],
				timestamp: "2026-04-01T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["CLAUDE.md"],
				modifications: [],
				timestamp: "2026-04-02T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["CLAUDE.md"],
				modifications: [],
				timestamp: "2026-04-03T10:00:00.000Z",
			}),
		];

		const reports = SessionMemoryManager.detectPassiveLoads(entries, ["CLAUDE.md"], 3);
		expect(reports).toHaveLength(0);
	});

	it("respects threshold — does not flag files below it", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				files_loaded: ["CLAUDE.md"],
				modifications: [],
				timestamp: "2026-04-01T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["CLAUDE.md"],
				modifications: [],
				timestamp: "2026-04-02T10:00:00.000Z",
			}),
		];

		const reports = SessionMemoryManager.detectPassiveLoads(entries, ["CLAUDE.md"], 3);
		expect(reports).toHaveLength(0);
	});

	it("does not flag non-always-include files", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				files_loaded: ["src/index.ts"],
				modifications: [],
				timestamp: "2026-04-01T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["src/index.ts"],
				modifications: [],
				timestamp: "2026-04-02T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["src/index.ts"],
				modifications: [],
				timestamp: "2026-04-03T10:00:00.000Z",
			}),
		];

		const reports = SessionMemoryManager.detectPassiveLoads(entries, ["CLAUDE.md"], 3);
		expect(reports).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// analyzeStaleness
// ---------------------------------------------------------------------------

describe("SessionMemoryManager.analyzeStaleness", () => {
	it("identifies files not modified across N sessions", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				files_loaded: ["src/a.ts", "src/b.ts"],
				modifications: ["src/a.ts"],
				timestamp: "2026-04-01T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["src/a.ts", "src/b.ts"],
				modifications: [],
				timestamp: "2026-04-02T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["src/a.ts", "src/b.ts"],
				modifications: [],
				timestamp: "2026-04-03T10:00:00.000Z",
			}),
		];

		const reports = SessionMemoryManager.analyzeStaleness(entries, ["src/a.ts", "src/b.ts"], [], 3);

		const staleFile = reports.find((r) => r.path === "src/b.ts");
		expect(staleFile).toBeDefined();
		expect(staleFile?.suggestion).toBe("remove-from-index");

		const activeFile = reports.find((r) => r.path === "src/a.ts");
		expect(activeFile).toBeUndefined();
	});

	it("flags always-include stale files as remove-from-always-include", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				files_loaded: ["CLAUDE.md"],
				modifications: [],
				timestamp: "2026-04-01T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["CLAUDE.md"],
				modifications: [],
				timestamp: "2026-04-02T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["CLAUDE.md"],
				modifications: [],
				timestamp: "2026-04-03T10:00:00.000Z",
			}),
		];

		const reports = SessionMemoryManager.analyzeStaleness(entries, ["CLAUDE.md"], ["CLAUDE.md"], 3);

		expect(reports[0]?.suggestion).toBe("remove-from-always-include");
	});

	it("flags indexed files never loaded as investigate when enough sessions exist", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				files_loaded: ["src/a.ts"],
				modifications: [],
				timestamp: "2026-04-01T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["src/a.ts"],
				modifications: [],
				timestamp: "2026-04-02T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["src/a.ts"],
				modifications: [],
				timestamp: "2026-04-03T10:00:00.000Z",
			}),
		];

		const reports = SessionMemoryManager.analyzeStaleness(
			entries,
			["src/a.ts", "src/orphan.ts"],
			[],
			3,
		);

		const orphan = reports.find((r) => r.path === "src/orphan.ts");
		expect(orphan).toBeDefined();
		expect(orphan?.suggestion).toBe("investigate");
		expect(orphan?.sessionCount).toBe(0);
	});

	it("does not flag files below threshold", () => {
		const entries: ContextLogEntry[] = [
			makeEntry({
				files_loaded: ["src/a.ts"],
				modifications: [],
				timestamp: "2026-04-01T10:00:00.000Z",
			}),
			makeEntry({
				files_loaded: ["src/a.ts"],
				modifications: [],
				timestamp: "2026-04-02T10:00:00.000Z",
			}),
		];

		const reports = SessionMemoryManager.analyzeStaleness(entries, ["src/a.ts"], [], 3);
		// src/a.ts is in indexed but the investigate branch only fires when entries.length >= threshold
		const loadedButNotModified = reports.filter(
			(r) => r.path === "src/a.ts" && r.suggestion !== "investigate",
		);
		expect(loadedButNotModified).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// prune
// ---------------------------------------------------------------------------

describe("SessionMemoryManager.prune", () => {
	it("removes entries older than cutoff date", () => {
		const e1 = makeEntry({ timestamp: "2026-01-01T00:00:00.000Z" });
		const e2 = makeEntry({ timestamp: "2026-03-01T00:00:00.000Z" });
		const e3 = makeEntry({ timestamp: "2026-04-01T00:00:00.000Z" });

		SessionMemoryManager.append(sessionDir, e1);
		SessionMemoryManager.append(sessionDir, e2);
		SessionMemoryManager.append(sessionDir, e3);

		const removed = SessionMemoryManager.prune(sessionDir, "2026-02-01");
		expect(removed).toBe(1);

		const remaining = SessionMemoryManager.load(sessionDir);
		expect(remaining).toHaveLength(2);
		expect(remaining[0]?.timestamp).toBe("2026-03-01T00:00:00.000Z");
	});

	it("returns 0 when nothing to remove", () => {
		const e1 = makeEntry({ timestamp: "2026-04-01T00:00:00.000Z" });
		SessionMemoryManager.append(sessionDir, e1);

		const removed = SessionMemoryManager.prune(sessionDir, "2026-01-01");
		expect(removed).toBe(0);
	});

	it("handles pruning all entries", () => {
		const e1 = makeEntry({ timestamp: "2026-01-01T00:00:00.000Z" });
		SessionMemoryManager.append(sessionDir, e1);

		const removed = SessionMemoryManager.prune(sessionDir, "2026-12-31");
		expect(removed).toBe(1);

		const remaining = SessionMemoryManager.load(sessionDir);
		expect(remaining).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// parseDuration
// ---------------------------------------------------------------------------

describe("SessionMemoryManager.parseDuration", () => {
	it("parses days correctly", () => {
		const ref = new Date("2026-04-13T00:00:00.000Z");
		const cutoff = SessionMemoryManager.parseDuration("30d", ref);
		expect(cutoff).toBe("2026-03-14");
	});

	it("parses months correctly", () => {
		const ref = new Date("2026-04-13T00:00:00.000Z");
		const cutoff = SessionMemoryManager.parseDuration("3mo", ref);
		expect(cutoff).toBe("2026-01-13");
	});

	it("parses years correctly", () => {
		const ref = new Date("2026-04-13T00:00:00.000Z");
		const cutoff = SessionMemoryManager.parseDuration("1y", ref);
		expect(cutoff).toBe("2025-04-13");
	});

	it("throws ParseError for invalid format", () => {
		expect(() => SessionMemoryManager.parseDuration("invalid")).toThrow(ParseError);
	});

	it("throws ParseError for empty string", () => {
		expect(() => SessionMemoryManager.parseDuration("")).toThrow(ParseError);
	});

	it("parses large durations correctly", () => {
		const ref = new Date("2026-04-13T00:00:00.000Z");
		const cutoff = SessionMemoryManager.parseDuration("365d", ref);
		expect(cutoff.length).toBe(10); // ISO date format
	});
});
