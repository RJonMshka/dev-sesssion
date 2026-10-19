/**
 * The context manifest — the session's record of what a prompt put in context
 * and why (LLD-code-units.md, REQ-UNIT-16..18).
 *
 * Built from the real pipeline: extractor → index → LayerResolver.plan →
 * PlainTextFormatter → ContextManifest.build. Nothing here is a hand-written
 * prompt line.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { AiIndex } from "../annotation/types.js";
import { contentHash } from "../annotation/unit-extractor.js";
import { LayerResolver } from "../calculators/layer-resolver.js";
import type { BootstrapContext } from "../formatters/bootstrap-formatter.js";
import { PlainTextFormatter } from "../formatters/plain-text-formatter.js";
import { ContextManifest } from "../managers/context-manifest.js";
import { CONTEXT_MANIFEST_FILENAME, ContextManifestSchema } from "../schemas/context-manifest.js";
import type { FileIndexEntry, Task } from "../schemas/index.js";

const SOURCES: Record<string, string> = {
	"src/utils/validate.ts": [
		"/** Parses a request body. */",
		"export function parseBody(body: unknown): unknown {",
		"  return body;",
		"}",
		"",
		"export function other(): void {}",
		"",
	].join("\n"),
	"src/app.ts": "export function createApp(): void {}\n",
	"src/server.ts": "export function listen(): void {}\n",
};

let root: string;
let index: AiIndex;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "context-manifest-"));
	const extractor = new AutoExtractor();
	const parsed = Object.entries(SOURCES).map(([rel, content]) => {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf-8");
		return extractor.extractFile(abs as ValidatedPath);
	});
	index = AiIndexBuilder.build(parsed, root);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const chunkFiles: FileIndexEntry[] = [
	{ filepath: "src/app.ts", chunk_tags: [1], purpose: "app" },
	{ filepath: "src/server.ts", chunk_tags: [1], purpose: "server" },
];
const alwaysIncludeFiles: FileIndexEntry[] = [
	{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "instructions", token_cost: 50 },
];
const tasks: Task[] = [
	{ text: "Make parseBody list every issue", status: "todo" },
	{ text: "Harden server.ts shutdown", status: "todo" },
];

/** Runs the real pipeline and returns the plan and the generated prompt. */
function generate() {
	const plan = LayerResolver.plan({ chunkFiles, alwaysIncludeFiles, tasks, index });
	const context: BootstrapContext = {
		state: {
			active_chunk: 1,
			session_id: "s",
			last_updated: "2026-10-18",
			tasks,
			last_worked_files: [],
			notes: [],
			completed_chunks: {},
			max_prompt_lines: 20,
		},
		chunk: { chunk_id: 1, title: "MVP", depends_on: [], tasks },
		chunkFiles,
		alwaysIncludeFiles,
		budget: {
			totalTokens: 1000,
			breakdown: { sessionState: 100, planChunk: 100, files: new Map(), alwaysInclude: 50 },
			overBudget: false,
			budgetCap: 50000,
			accurate: false,
		},
		excludePatterns: [],
		projectName: "demo",
		resolvedLayers: plan.layers,
		focusUnits: plan.focus,
	};
	const prompt = PlainTextFormatter.generatePrompt(context);
	return { plan, prompt };
}

describe("LayerResolver.plan", () => {
	it("returns focus alongside layers", () => {
		const { plan } = generate();
		expect(plan.focus.map((u) => u.ref)).toEqual(["src/utils/validate.ts#parseBody"]);
		expect(plan.layers.find((l) => l.filepath === "src/server.ts")?.escalated).toBe(true);
	});
});

describe("ContextManifest.build", () => {
	it("records one entry per item, with granularity, cost, hash and reason (REQ-UNIT-16, REQ-UNIT-17)", () => {
		const { plan, prompt } = generate();
		const m = ContextManifest.build({ plan, index, prompt, activeChunk: 1 });

		const unit = m.entries.find((e) => e.ref === "src/utils/validate.ts#parseBody");
		expect(unit).toMatchObject({
			path: "src/utils/validate.ts",
			granularity: "unit",
			reason: "task",
			task: "Make parseBody list every issue",
			start: 1,
			end: 4,
			hash: index.files["src/utils/validate.ts"]?.units?.parseBody?.hash,
			file_tokens: index.files["src/utils/validate.ts"]?.token_cost,
			listed: true,
		});
		expect(unit?.tokens).toBeLessThan(unit?.file_tokens ?? 0);

		const server = m.entries.find((e) => e.ref === "src/server.ts");
		expect(server).toMatchObject({
			granularity: "file",
			reason: "task",
			task: "Harden server.ts shutdown",
			hash: index.files["src/server.ts"]?.hash,
		});

		// The builder defaults every indexed file to layer_default 1, which
		// raises a chunk file's layer-0 base to signatures.
		const app = m.entries.find((e) => e.ref === "src/app.ts");
		expect(app).toMatchObject({ granularity: "signature", reason: "chunk" });

		const claude = m.entries.find((e) => e.ref === "CLAUDE.md");
		expect(claude).toMatchObject({ granularity: "signature", reason: "always-include" });
		// Not in the ai-index: no hash to record, rather than an invented one.
		expect(claude?.hash).toBeUndefined();

		expect(m.entries).toHaveLength(4);
		expect(() => ContextManifestSchema.parse(m)).not.toThrow();
	});

	it("totals tokens, and counts each file once in the whole-file equivalent (REQ-UNIT-17)", () => {
		const { plan, prompt } = generate();
		const m = ContextManifest.build({ plan, index, prompt, activeChunk: 1 });
		expect(m.totals.tokens).toBe(m.entries.reduce((n, e) => n + e.tokens, 0));
		const perPath = new Map(m.entries.map((e) => [e.path, e.file_tokens]));
		expect(m.totals.file_tokens).toBe([...perPath.values()].reduce((n, t) => n + t, 0));
	});

	it("records the hash of the prompt it describes (REQ-UNIT-18)", () => {
		const { plan, prompt } = generate();
		const m = ContextManifest.build({ plan, index, prompt, activeChunk: 1 });
		expect(m.prompt_hash).toBe(contentHash(prompt));
		expect(m.active_chunk).toBe(1);
	});

	it("marks an item the capped prompt line left out as not listed", () => {
		const many: FileIndexEntry[] = Array.from({ length: 9 }, (_, i) => ({
			filepath: `src/f${String(i)}.ts`,
			chunk_tags: [1],
			purpose: "x",
			token_cost: 10,
		}));
		const plan = LayerResolver.plan({ chunkFiles: many, alwaysIncludeFiles: [], tasks: [], index });
		const prompt = `Project: p\nActive chunk: 1\nSummaries (read_file_layer for detail): ${many
			.slice(0, 6)
			.map((f) => `${f.filepath}·L0`)
			.join(", ")}, +3 more`;
		const m = ContextManifest.build({ plan, index, prompt, activeChunk: 1 });
		expect(m.entries.filter((e) => e.listed)).toHaveLength(6);
		expect(m.entries.filter((e) => !e.listed).map((e) => e.path)).toEqual([
			"src/f6.ts",
			"src/f7.ts",
			"src/f8.ts",
		]);
	});
});

describe("ContextManifest.build without an ai-index", () => {
	it("records every file at full granularity, as the flat Load line loads it (REQ-UNIT-17)", () => {
		const plan = LayerResolver.plan({ chunkFiles, alwaysIncludeFiles, tasks, index: null });
		const prompt = PlainTextFormatter.generatePrompt({
			state: {
				active_chunk: 1,
				session_id: "s",
				last_updated: "2026-10-18",
				tasks,
				last_worked_files: [],
				notes: [],
				completed_chunks: {},
				max_prompt_lines: 20,
			},
			chunk: { chunk_id: 1, title: "MVP", depends_on: [], tasks },
			chunkFiles,
			alwaysIncludeFiles,
			budget: {
				totalTokens: 1000,
				breakdown: { sessionState: 1, planChunk: 1, files: new Map(), alwaysInclude: 1 },
				overBudget: false,
				budgetCap: 50000,
				accurate: false,
			},
			excludePatterns: [],
			projectName: "demo",
		});
		const m = ContextManifest.build({ plan, index: null, prompt, activeChunk: 1 });
		expect(plan.focus).toEqual([]);
		expect(m.entries.map((e) => e.granularity)).toEqual(["file", "file", "file"]);
		for (const e of m.entries) {
			expect(e.tokens).toBe(e.file_tokens);
			expect(e.listed).toBe(true);
		}
	});
});

describe("ContextManifest.write / load", () => {
	it("round-trips through .session/ and serializes deterministically", () => {
		const { plan, prompt } = generate();
		const m = ContextManifest.build({ plan, index, prompt, activeChunk: 1 });
		const sessionDir = path.join(root, ".session");
		fs.mkdirSync(sessionDir);

		ContextManifest.write(sessionDir as ValidatedPath, m);
		const file = path.join(sessionDir, CONTEXT_MANIFEST_FILENAME);
		const first = fs.readFileSync(file, "utf-8");
		expect(ContextManifest.load(sessionDir as ValidatedPath)).toEqual(m);

		ContextManifest.write(sessionDir as ValidatedPath, m);
		expect(fs.readFileSync(file, "utf-8")).toBe(first);
		expect(first.endsWith("\n")).toBe(true);
	});

	it("returns null when no manifest exists", () => {
		expect(ContextManifest.load(root as ValidatedPath)).toBeNull();
	});

	it("rejects a manifest with an unknown key", () => {
		fs.writeFileSync(
			path.join(root, CONTEXT_MANIFEST_FILENAME),
			JSON.stringify({ version: 1, surprise: true }),
		);
		expect(() => ContextManifest.load(root as ValidatedPath)).toThrow();
	});
});
