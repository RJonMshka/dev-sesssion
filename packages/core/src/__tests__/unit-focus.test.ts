/**
 * Unit focus — choosing which code units a task names (REQ-UNIT-7..12).
 *
 * The index under test is built by the real extractor from real files, so the
 * ids and ranges are what the pipeline actually produces.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { AiIndex } from "../annotation/types.js";
import { LayerResolver } from "../calculators/layer-resolver.js";
import { MAX_FOCUS_UNITS, UnitFocusResolver } from "../calculators/unit-focus.js";
import type { FileIndexEntry, Task } from "../schemas/index.js";

const FILES: Record<string, string> = {
	"src/utils/validate.ts": [
		"/** Parses a request body. */",
		"export function parseBody(body: unknown): unknown {",
		"  return formatIssues(body);",
		"}",
		"",
		"function formatIssues(x: unknown): unknown {",
		"  return x;",
		"}",
		"",
		"export function validate(x: unknown): boolean {",
		"  return x !== null;",
		"}",
		"",
	].join("\n"),
	"src/middleware/auth.ts": [
		"export function requireAuth(): void {}",
		"",
		"export class TokenStore {",
		"  verifyToken(t: string): boolean {",
		"    return t.length > 0;",
		"  }",
		"",
		"  refresh(): void {}",
		"}",
		"",
	].join("\n"),
	"src/cache.ts": [
		"export class SessionCache {",
		"  refresh(): void {}",
		"}",
		"",
		"export function pick(a: string): string;",
		"export function pick(a: unknown): unknown {",
		"  return a;",
		"}",
		"",
	].join("\n"),
	"src/a.ts": "export function sharedHelper(): void {}\n",
	"src/b.ts": "export function sharedHelper(): void {}\n",
};

let root: string;
let index: AiIndex;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "unit-focus-"));
	const extractor = new AutoExtractor();
	const parsed = Object.entries(FILES).map(([rel, content]) => {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf-8");
		return extractor.extractFile(abs as ValidatedPath);
	});
	index = AiIndexBuilder.build(parsed, root);
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** A todo task. */
function todo(text: string): Task {
	return { text, status: "todo" };
}

/** The refs the resolver focuses for these tasks. */
function refs(tasks: readonly Task[]): string[] {
	return UnitFocusResolver.resolve({ tasks, index }).focused.map((u) => u.ref);
}

describe("UnitFocusResolver", () => {
	it("focuses a unit named by a camelCase identifier (REQ-UNIT-7)", () => {
		expect(refs([todo("Make parseBody list every issue")])).toEqual([
			"src/utils/validate.ts#parseBody",
		]);
	});

	it("focuses a class named in PascalCase, and a uniquely named method (REQ-UNIT-7)", () => {
		expect(refs([todo("TokenStore should expire tokens")])).toEqual([
			"src/middleware/auth.ts#TokenStore",
		]);
		expect(refs([todo("verifyToken rejects empty strings")])).toEqual([
			"src/middleware/auth.ts#TokenStore.verifyToken",
		]);
	});

	it("searches the whole index, not just one file (REQ-UNIT-7)", () => {
		expect(refs([todo("Wire requireAuth into the router")])).toEqual([
			"src/middleware/auth.ts#requireAuth",
		]);
	});

	it("records range, cost, hash and the causing task (REQ-UNIT-7)", () => {
		const [unit] = UnitFocusResolver.resolve({
			tasks: [todo("Make parseBody list every issue")],
			index,
		}).focused;
		const entry = index.files["src/utils/validate.ts"];
		expect(unit).toMatchObject({
			filepath: "src/utils/validate.ts",
			id: "parseBody",
			start: 1,
			end: 4,
			tokens: entry?.units?.parseBody?.tokens,
			hash: entry?.units?.parseBody?.hash,
			fileTokens: entry?.token_cost,
			task: "Make parseBody list every issue",
		});
	});

	it("ignores a plain lowercase word unless it is backticked (REQ-UNIT-8)", () => {
		expect(refs([todo("validate the input before saving")])).toEqual([]);
		expect(refs([todo("Fix the edge case in `validate`")])).toEqual([
			"src/utils/validate.ts#validate",
		]);
		expect(refs([todo("Call `validate()` first")])).toEqual(["src/utils/validate.ts#validate"]);
	});

	it("focuses nothing for a name declared in two files, neither used, and reports it (REQ-UNIT-32)", () => {
		const result = UnitFocusResolver.resolve({ tasks: [todo("Rename sharedHelper")], index });
		expect(result.focused).toEqual([]);
		expect(result.ambiguous).toEqual(["sharedHelper"]);
	});

	it("treats an unused method name shared by two classes as ambiguous (REQ-UNIT-32)", () => {
		const result = UnitFocusResolver.resolve({ tasks: [todo("`refresh` leaks a timer")], index });
		expect(result.focused).toEqual([]);
		expect(result.ambiguous).toEqual(["refresh"]);
	});

	it("focuses overload siblings together rather than calling them ambiguous (REQ-UNIT-30)", () => {
		expect(refs([todo("`pick` should narrow")])).toEqual([
			"src/cache.ts#pick",
			"src/cache.ts#pick~2",
		]);
	});

	it("focuses the member, not its parent, for a qualified name (REQ-UNIT-10)", () => {
		expect(refs([todo("TokenStore.refresh must rotate the key")])).toEqual([
			"src/middleware/auth.ts#TokenStore.refresh",
		]);
	});

	it("focuses nothing for a done task (REQ-UNIT-11)", () => {
		expect(refs([{ text: "Make parseBody strict", status: "done" }])).toEqual([]);
	});

	it("dedupes across tasks, keeps first-mention order, and caps the list", () => {
		const tasks = [
			todo("requireAuth then parseBody"),
			todo("parseBody again, and TokenStore"),
			todo("verifyToken, TokenStore.refresh, `validate`, SessionCache"),
		];
		const focused = refs(tasks);
		expect(focused.slice(0, 3)).toEqual([
			"src/middleware/auth.ts#requireAuth",
			"src/utils/validate.ts#parseBody",
			"src/middleware/auth.ts#TokenStore",
		]);
		expect(focused).toHaveLength(MAX_FOCUS_UNITS);
		expect(new Set(focused).size).toBe(focused.length);
	});

	it("focuses nothing when the index has no units", () => {
		const legacy: AiIndex = {
			...index,
			files: Object.fromEntries(
				Object.entries(index.files).map(([k, v]) => [k, { ...v, units: undefined }]),
			),
		};
		const result = UnitFocusResolver.resolve({ tasks: [todo("parseBody")], index: legacy });
		expect(result.focused).toEqual([]);
	});
});

describe("LayerResolver with focus", () => {
	const chunkFiles: FileIndexEntry[] = [
		{ filepath: "src/utils/validate.ts", chunk_tags: [1], purpose: "validation" },
	];

	it("does not escalate a file whose unit the same task focuses (REQ-UNIT-12)", () => {
		const tasks = [todo("Fix parseBody in validate.ts")];
		const focus = UnitFocusResolver.resolve({ tasks, index }).focused;
		expect(focus.map((u) => u.ref)).toEqual(["src/utils/validate.ts#parseBody"]);

		const [resolved] = LayerResolver.resolve({
			chunkFiles,
			alwaysIncludeFiles: [],
			tasks,
			index,
			focus,
		});
		expect(resolved?.escalated).toBe(false);
		expect(resolved?.layer).toBe(resolved?.baseLayer);
	});

	it("still escalates a file a task names without naming a unit in it (REQ-UNIT-12)", () => {
		const tasks = [todo("Refactor validate.ts")];
		const focus = UnitFocusResolver.resolve({ tasks, index }).focused;
		const [resolved] = LayerResolver.resolve({
			chunkFiles,
			alwaysIncludeFiles: [],
			tasks,
			index,
			focus,
		});
		expect(resolved?.escalated).toBe(true);
		expect(resolved?.layer).toBe(2);
	});
});

describe("ContextBudgetCalculator with focus", () => {
	it("charges each focused unit at its own cost, keyed by ref (REQ-UNIT-17)", async () => {
		const { ContextBudgetCalculator } = await import("../calculators/context-budget-calculator.js");
		const tasks = [todo("Make parseBody list every issue")];
		const plan = LayerResolver.plan({ chunkFiles: [], alwaysIncludeFiles: [], tasks, index });
		const state = {
			active_chunk: 1,
			session_id: "s",
			last_updated: "2026-10-18",
			tasks,
			last_worked_files: [],
			notes: [],
			completed_chunks: {},
			max_prompt_lines: 20,
		};
		const chunk = { chunk_id: 1, title: "t", depends_on: [], tasks };
		const without = ContextBudgetCalculator.estimateLayered(state, chunk, plan.layers);
		const withFocus = ContextBudgetCalculator.estimateLayered(
			state,
			chunk,
			plan.layers,
			undefined,
			plan.focus,
		);
		const unitTokens = plan.focus[0]?.tokens ?? 0;
		expect(unitTokens).toBeGreaterThan(0);
		expect(withFocus.totalTokens - without.totalTokens).toBe(unitTokens);
		expect(withFocus.breakdown.files.get("src/utils/validate.ts#parseBody")).toBe(unitTokens);
	});
});
