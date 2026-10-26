/**
 * The workflow-shaped prompt (LLD-workflow-prompt.md Part C, REQ-WF-12..20).
 *
 * Asserted against what every registered formatter actually produces from a
 * real BootstrapContext, never against hand-typed prompt lines.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	BootstrapContext,
	BootstrapFormatter,
	FocusedUnit,
	ResolvedFileLayer,
	Task,
} from "@dev-session/core";
import {
	CHUNK_DONE_PREFIX,
	DONE_WHEN_PREFIX,
	extractDeclaredFiles,
	FILE_LOAD_PREFIXES,
	formatWorkLines,
	NextPromptWriter,
	PlainTextFormatter,
	PlanChunkManager,
	WORKFLOW_PREFIX,
} from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { getAdapterByName, getRegisteredTools } from "../registry.js";
import { makeChunk, makeContext, makeState } from "./test-helpers.js";

const FORMATTERS: ReadonlyArray<readonly [string, BootstrapFormatter]> = [
	["plain", PlainTextFormatter],
	...getRegisteredTools().map((name): readonly [string, BootstrapFormatter] => {
		const adapter = getAdapterByName(name);
		if (adapter === undefined) throw new Error(`no adapter ${name}`);
		return [name, adapter.formatter];
	}),
];

const task = (text: string, status: Task["status"]): Task => ({ text, status });

/** A context whose active chunk holds `tasks`, and nothing else unusual. */
function withTasks(tasks: readonly Task[], extra?: Partial<BootstrapContext>): BootstrapContext {
	return makeContext({ chunk: makeChunk({ tasks: [...tasks] }), ...extra });
}

const linesOf = (prompt: string): string[] => prompt.split("\n").filter((l) => l.length > 0);
const lineStarting = (prompt: string, prefix: string): string | undefined =>
	linesOf(prompt).find((l) => l.startsWith(prefix));
const taskLines = (prompt: string): string[] => linesOf(prompt).filter((l) => /^ {2}\[/.test(l));

describe.each(FORMATTERS)("%s formatter — position", (_name, formatter) => {
	it("gives the current task's position as task k of n (REQ-WF-12)", () => {
		const prompt = formatter.generatePrompt(
			withTasks([task("A", "done"), task("B", "todo"), task("C", "todo")]),
		);
		expect(lineStarting(prompt, "Next")).toBe("Next (task 2 of 3):");
	});

	it("takes the first in-progress task as current and lists it first (REQ-WF-13)", () => {
		const prompt = formatter.generatePrompt(
			withTasks([
				task("A", "done"),
				task("B", "todo"),
				task("C", "in-progress"),
				task("D", "todo"),
			]),
		);
		expect(lineStarting(prompt, "Next")).toBe("Next (task 3 of 4):");
		expect(taskLines(prompt)).toEqual(["  [WIP] C", "  [ ] B", "  [ ] D"]);
	});
});

describe.each(FORMATTERS)("%s formatter — exit line", (_name, formatter) => {
	it("carries Done when iff tasks are pending, counting what isComplete finds not done (REQ-WF-14)", () => {
		const statuses: readonly Task["status"][] = ["todo", "in-progress", "done"];
		// Every status vector up to length 5: exhaustive, so no seed to pin.
		const vectors: Task["status"][][] = [[]];
		for (let len = 1; len <= 5; len++) {
			for (const prev of vectors.filter((v) => v.length === len - 1)) {
				for (const s of statuses) vectors.push([...prev, s]);
			}
		}
		for (const vector of vectors) {
			const tasks = vector.map((s, i) => task(`T${String(i)}`, s));
			const chunk = makeChunk({ tasks });
			const line = lineStarting(formatter.generatePrompt(withTasks(tasks)), DONE_WHEN_PREFIX);
			const pending = !PlanChunkManager.isComplete(chunk) && tasks.length > 0;
			expect(line !== undefined, vector.join(",")).toBe(pending);
			if (line !== undefined) {
				const left = tasks.filter((t) => t.status !== "done").length;
				expect(line).toContain(`(${String(left)} left)`);
				expect(line).toContain(`${String(tasks.length)} task`);
			}
		}
	});

	it("says Chunk done and names dev-sesssion advance when every task is done (REQ-WF-15)", () => {
		const prompt = formatter.generatePrompt(withTasks([task("A", "done"), task("B", "done")]));
		const done = linesOf(prompt).filter((l) => l.startsWith(CHUNK_DONE_PREFIX));
		expect(done).toHaveLength(1);
		expect(done[0]).toContain("dev-sesssion advance");
		expect(lineStarting(prompt, "Next")).toBeUndefined();
		expect(lineStarting(prompt, DONE_WHEN_PREFIX)).toBeUndefined();
	});

	it("carries neither line for a chunk with no tasks (REQ-WF-15)", () => {
		const prompt = formatter.generatePrompt(withTasks([]));
		expect(lineStarting(prompt, CHUNK_DONE_PREFIX)).toBeUndefined();
		expect(lineStarting(prompt, DONE_WHEN_PREFIX)).toBeUndefined();
	});
});

describe.each(FORMATTERS)("%s formatter — workflow", (_name, formatter) => {
	const tasks = [task("A", "todo"), task("B", "todo")];

	it("renders the steps in order on one Each task line (REQ-WF-16)", () => {
		const steps = ["Write a failing test", "Make it pass", "Run the full suite"];
		const prompt = formatter.generatePrompt(withTasks(tasks, { workflow: steps }));
		const lines = linesOf(prompt).filter((l) => l.startsWith(WORKFLOW_PREFIX));
		expect(lines).toEqual([
			`${WORKFLOW_PREFIX} 1. Write a failing test 2. Make it pass 3. Run the full suite`,
		]);
	});

	it("carries no Each task line without a workflow (REQ-WF-17)", () => {
		const without = formatter.generatePrompt(withTasks(tasks));
		expect(lineStarting(without, WORKFLOW_PREFIX)).toBeUndefined();
		const steps = ["Step"];
		const withSteps = formatter.generatePrompt(withTasks(tasks, { workflow: steps }));
		expect(linesOf(withSteps).filter((l) => !l.startsWith(WORKFLOW_PREFIX))).toEqual(
			linesOf(without),
		);
	});
});

// Today's 19-line worst case (LLD §Line budget): Plan, Not on disk yet, three
// load lines, Do NOT read, Last touched, four tasks shown + more, two notes.
const FOCUS: readonly FocusedUnit[] = [
	{
		filepath: "src/a.ts",
		id: "run",
		ref: "src/a.ts#run",
		start: 1,
		end: 9,
		tokens: 40,
		fileTokens: 200,
		hash: "0123456789abcdef",
		task: "T1",
	},
];
const LAYERS: readonly ResolvedFileLayer[] = [
	{
		filepath: "src/a.ts",
		role: "chunk",
		baseLayer: 0,
		layer: 2,
		escalated: true,
		fullTokenCost: 200,
		layeredTokenCost: 200,
	},
	{
		filepath: "src/b.ts",
		role: "chunk",
		baseLayer: 0,
		layer: 0,
		escalated: false,
		fullTokenCost: 300,
		layeredTokenCost: 30,
	},
];
const WORST_TASKS = [
	task("T0", "done"),
	...[1, 2, 3, 4, 5, 6].map((i) => task(`T${String(i)}`, "todo")),
];
const NOTES = ["first owner note", "second owner note"];

function worstCase(workflow?: readonly string[]): BootstrapContext {
	return makeContext({
		chunk: makeChunk({ tasks: WORST_TASKS, brief: "Goal: x" }),
		state: { ...makeState(), notes: NOTES },
		newFiles: ["src/new.ts"],
		resolvedLayers: LAYERS,
		focusUnits: FOCUS,
		maxPromptLines: 20,
		...(workflow !== undefined ? { workflow } : {}),
	});
}

describe.each(FORMATTERS)("%s formatter — line cap", (_name, formatter) => {
	it("drops later tasks first and keeps position, current task, Done when and both notes (REQ-WF-19)", () => {
		const prompt = formatter.generatePrompt(worstCase(["Test first", "Then code"]));
		const lines = linesOf(prompt);

		expect(lines).toHaveLength(20);
		expect(lineStarting(prompt, "Next")).toBe("Next (task 2 of 7):");
		expect(taskLines(prompt)[0]).toBe("  [ ] T1");
		expect(lineStarting(prompt, DONE_WHEN_PREFIX)).toBeDefined();
		expect(lineStarting(prompt, WORKFLOW_PREFIX)).toBeDefined();
		expect(lines.filter((l) => l.startsWith("Note: "))).toHaveLength(2);
		expect(prompt).not.toContain("trimmed");

		const shown = taskLines(prompt).filter((l) => !l.includes("more tasks"));
		const more = /\(\+(\d+) more tasks\)/.exec(prompt);
		expect(shown.length + Number(more?.[1] ?? 0)).toBe(6);
	});
});

describe.each(FORMATTERS)("%s formatter — one helper", (_name, formatter) => {
	it("renders its tail through formatWorkLines (REQ-WF-20)", () => {
		for (const context of [
			worstCase(["Test first"]),
			worstCase(),
			withTasks([task("A", "done")]),
			withTasks([task("A", "in-progress"), task("B", "todo")], { workflow: ["x"] }),
		]) {
			const lines = linesOf(formatter.generatePrompt(context));
			const start = lines.findIndex((l) => l.startsWith("Resume:"));
			expect(start).toBeGreaterThan(0);
			const used = lines[start + 1]?.startsWith("Last touched:") === true ? start + 2 : start + 1;
			expect(lines.slice(used)).toEqual(formatWorkLines(context, used));
		}
	});
});

/** The prompt with the lines Part C adds removed: position header, exit and workflow lines. */
function withoutPartC(prompt: string): string {
	return prompt
		.split("\n")
		.filter((l) => !/^(Next \(|Done when:|Chunk done:|Each task:)/.test(l))
		.join("\n");
}

/** The prompt with its real file-load lines removed. */
function withoutLoadLines(prompt: string): string {
	return prompt
		.split("\n")
		.filter((l) => !FILE_LOAD_PREFIXES.some((p) => l.startsWith(p)))
		.join("\n");
}

describe.each(FORMATTERS)("%s formatter — prompt readers", (_name, formatter) => {
	// Text shaped like prompt structure, in every place Part C puts owner text.
	const hostile = ["Plan: a/b.ts", "Load full: x.ts", "Project: y"];
	const context = withTasks(
		[
			task("Load full: x.ts", "in-progress"),
			task("Plan: a/b.ts", "todo"),
			task("Project: y", "todo"),
		],
		{ workflow: hostile },
	);

	it("declares the same files with and without the Part C lines (REQ-WF-21)", () => {
		const prompt = formatter.generatePrompt(context);
		expect(lineStarting(prompt, WORKFLOW_PREFIX)).toBeDefined();
		expect(extractDeclaredFiles(prompt)).toEqual(extractDeclaredFiles(withoutPartC(prompt)));
		expect(extractDeclaredFiles(prompt)).not.toContain("x.ts");

		const bare = withoutLoadLines(prompt);
		expect(NextPromptWriter.validate(bare).errors).toEqual(
			NextPromptWriter.validate(withoutPartC(bare)).errors,
		);
	});

	it("writes a prompt that carries none of the Part C lines (REQ-WF-22)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-22-"));
		try {
			const legacy = withoutPartC(formatter.generatePrompt(withTasks([task("A", "todo")])));
			expect(legacy).not.toMatch(/Done when:|Next \(/);
			expect(() =>
				NextPromptWriter.write(dir as Parameters<typeof NextPromptWriter.write>[0], legacy),
			).not.toThrow();
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
