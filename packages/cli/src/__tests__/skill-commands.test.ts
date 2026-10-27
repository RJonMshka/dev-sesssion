/**
 * Every `dev-sesssion` command named in agent-facing text resolves against the
 * real Commander program (LLD-plan-authoring.md, REQ-PLA-12, REQ-ORC-3).
 *
 * The text is generated, not copied: a renamed command or flag fails here
 * instead of failing an agent that follows the text.
 */

import { renderPlanSkill } from "@dev-session/adapters";
import { noPlanDirection } from "@dev-session/core";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { createProgram } from "../cli.js";

/** One `dev-sesssion …` invocation found in text. */
interface Invocation {
	readonly text: string;
	readonly tokens: readonly string[];
}

/**
 * Finds every `dev-sesssion` invocation: the name, then the words after it up
 * to the end of the line, a closing backtick, or punctuation.
 */
function findInvocations(text: string): Invocation[] {
	const found: Invocation[] = [];
	for (const m of text.matchAll(/(?<![\w/-])dev-sesssion((?: +[^\s`,;:)]+)*)/g)) {
		const tokens = (m[1] ?? "").trim().split(/ +/).filter(Boolean);
		if (tokens.length > 0) found.push({ text: m[0], tokens });
	}
	return found;
}

/** Long and short flags a command accepts. */
function flagsOf(cmd: Command): Set<string> {
	const flags = new Set<string>();
	for (const o of cmd.options) {
		if (o.long !== undefined) flags.add(o.long);
		if (o.short !== undefined) flags.add(o.short);
	}
	return flags;
}

/**
 * Walks the tokens down the command tree. Words name subcommands until a
 * command with no subcommands is reached; after that, words are arguments.
 * Every flag must belong to the command reached or to the root program.
 *
 * @returns Problems found; empty when the invocation resolves.
 */
function resolve(program: Command, tokens: readonly string[]): string[] {
	const problems: string[] = [];
	let cmd = program;
	let atLeaf = false;
	for (const token of tokens) {
		if (token.startsWith("-")) {
			const name = token.split("=")[0] ?? token;
			if (!flagsOf(cmd).has(name) && !flagsOf(program).has(name)) {
				problems.push(`${cmd.name()} has no option ${name}`);
			}
			continue;
		}
		if (atLeaf) continue; // an argument, such as <file>
		const sub = cmd.commands.find((c) => c.name() === token || c.aliases().includes(token));
		if (sub === undefined) {
			problems.push(`${cmd.name()} has no subcommand ${token}`);
			atLeaf = true;
			continue;
		}
		cmd = sub;
		atLeaf = cmd.commands.length === 0;
	}
	if (!atLeaf) problems.push(`${cmd.name()} needs a subcommand`);
	return problems;
}

/** Resolves every invocation in `text`; returns the ones that fail, with why. */
function unresolved(text: string): string[] {
	const program = createProgram();
	return findInvocations(text).flatMap((inv) =>
		resolve(program, inv.tokens).map((p) => `${inv.text}: ${p}`),
	);
}

describe("the command resolver", () => {
	it("catches a misspelled subcommand and an unknown flag", () => {
		expect(unresolved("run `dev-sesssion plan chek <file>`")).toHaveLength(1);
		expect(unresolved("run `dev-sesssion advance --jsonn`")).toHaveLength(1);
		expect(unresolved("run `dev-sesssion plan`")).toHaveLength(1);
		expect(unresolved("run `dev-sesssion plan check <file> --json -y`")).toEqual([]);
	});
});

describe("init's no-plan direction", () => {
	it("names only commands and flags the CLI registers (REQ-ORC-3)", () => {
		for (const placeholder of [true, false]) {
			const text = noPlanDirection({ placeholder });
			expect(findInvocations(text).length).toBeGreaterThanOrEqual(2);
			expect(unresolved(text)).toEqual([]);
		}
	});
});

describe("the plan skill", () => {
	it("names only commands and flags the CLI registers (REQ-PLA-12)", () => {
		// Commands are code spans; the description names the tool in prose ("dev-sesssion splits").
		const spans = [...renderPlanSkill("9.9.9").matchAll(/`([^`\n]+)`/g)];
		const text = spans.map((m) => `\`${m[1] ?? ""}\``).join("\n");
		const names = findInvocations(text).map((inv) => inv.tokens[0]);
		// The skill drives the whole loop; a resolver that found nothing would pass vacuously.
		for (const cmd of ["plan", "init", "status", "prompt", "advance"]) expect(names).toContain(cmd);
		expect(unresolved(text)).toEqual([]);
	});
});
