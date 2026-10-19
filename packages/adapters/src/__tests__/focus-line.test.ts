/**
 * The Focus line — one prompt line naming focused code units
 * (LLD-code-units.md, REQ-UNIT-13..15).
 *
 * Asserted against real formatter output for every registered adapter plus the
 * plain-text fallback, and read back by the real replay scorer and validator,
 * so emitter, parser and validator cannot drift apart unnoticed.
 */

import type { FocusedUnit, ResolvedFileLayer } from "@dev-session/core";
import {
	extractDeclaredFiles,
	FOCUS_PREFIX,
	NextPromptWriter,
	PlainTextFormatter,
} from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { getAdapterByName, getRegisteredTools } from "../registry.js";
import { makeContext } from "./test-helpers.js";

const FOCUS: readonly FocusedUnit[] = [
	{
		filepath: "src/utils/validate.ts",
		id: "parseBody",
		ref: "src/utils/validate.ts#parseBody",
		start: 3,
		end: 18,
		tokens: 120,
		fileTokens: 900,
		hash: "0123456789abcdef",
		task: "Make parseBody list every issue",
	},
	{
		filepath: "src/middleware/auth.ts",
		id: "TokenStore.refresh",
		ref: "src/middleware/auth.ts#TokenStore.refresh",
		start: 40,
		end: 52,
		tokens: 80,
		fileTokens: 1400,
		hash: "fedcba9876543210",
		task: "TokenStore.refresh must rotate the key",
	},
];

const LAYERS: readonly ResolvedFileLayer[] = [
	{
		filepath: "src/app.ts",
		role: "chunk",
		baseLayer: 0,
		layer: 0,
		escalated: false,
		fullTokenCost: 500,
		layeredTokenCost: 40,
	},
];

const FORMATTERS = [
	...getRegisteredTools().map((tool) => {
		const adapter = getAdapterByName(tool);
		if (adapter === undefined) throw new Error(`no adapter for ${tool}`);
		return [tool, adapter.formatter] as const;
	}),
	["plain", PlainTextFormatter] as const,
];

/** The generated Focus line, or undefined. */
function focusLine(prompt: string): string | undefined {
	return prompt
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.startsWith(FOCUS_PREFIX));
}

describe.each(FORMATTERS)("%s formatter Focus line", (_name, formatter) => {
	it("lists each focused unit as path#id:start-end (REQ-UNIT-13)", () => {
		const prompt = formatter.generatePrompt(
			makeContext({ resolvedLayers: LAYERS, focusUnits: FOCUS }),
		);
		const line = focusLine(prompt);
		expect(line).toBe(
			`${FOCUS_PREFIX} src/utils/validate.ts#parseBody:3-18, src/middleware/auth.ts#TokenStore.refresh:40-52`,
		);
		// Exactly one Focus line.
		expect(prompt.split("\n").filter((l) => l.trim().startsWith(FOCUS_PREFIX))).toHaveLength(1);
	});

	it("emits no Focus line when nothing is focused (REQ-UNIT-13)", () => {
		const prompt = formatter.generatePrompt(makeContext({ resolvedLayers: LAYERS }));
		expect(focusLine(prompt)).toBeUndefined();
	});

	it("is read back by the replay scorer as file paths (REQ-UNIT-14)", () => {
		const prompt = formatter.generatePrompt(
			makeContext({ resolvedLayers: LAYERS, focusUnits: FOCUS }),
		);
		const declared = extractDeclaredFiles(prompt);
		expect(declared).toContain("src/utils/validate.ts");
		expect(declared).toContain("src/middleware/auth.ts");
		expect(declared.some((d) => d.includes("#"))).toBe(false);
	});

	it("passes validation when Focus is the only load line (REQ-UNIT-15)", () => {
		const prompt = formatter.generatePrompt(makeContext({ resolvedLayers: [], focusUnits: FOCUS }));
		expect(focusLine(prompt)).toBeDefined();
		const result = NextPromptWriter.validate(prompt);
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
	});
});
