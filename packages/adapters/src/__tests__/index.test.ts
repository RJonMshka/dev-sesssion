/**
 * Barrel contract tests for @dev-session/adapters.
 *
 * Imports go through `../index.js` on purpose: the point is to prove the
 * public entry point wires each adapter to the registry consistently.
 * Per-adapter behavior lives in the dedicated suites.
 */

import { describe, expect, it } from "vitest";
import {
	ClaudeAdapter,
	ClaudeBootstrapFormatter,
	CursorAdapter,
	CursorBootstrapFormatter,
	getAdapterForTool,
	getFormatterForTool,
	getRegisteredTools,
	OpencodeAdapter,
	OpencodeBootstrapFormatter,
	WindsurfAdapter,
	WindsurfBootstrapFormatter,
} from "../index.js";

const BUILTIN_ADAPTERS = [
	{ name: "claude", adapter: ClaudeAdapter, formatter: ClaudeBootstrapFormatter },
	{ name: "opencode", adapter: OpencodeAdapter, formatter: OpencodeBootstrapFormatter },
	{ name: "cursor", adapter: CursorAdapter, formatter: CursorBootstrapFormatter },
	{ name: "windsurf", adapter: WindsurfAdapter, formatter: WindsurfBootstrapFormatter },
] as const;

describe("@dev-session/adapters public surface", () => {
	it.each(BUILTIN_ADAPTERS)("$name adapter is internally consistent and registered", ({
		name,
		adapter,
		formatter,
	}) => {
		// The exported adapter, its formatter, and the registry must agree —
		// a mismatch here means the barrel and registry drifted apart.
		expect(adapter.config.name).toBe(name);
		expect(adapter.formatter).toBe(formatter);
		expect(formatter.name).toBe(name);
		expect(getAdapterForTool(name)).toBe(adapter);
		expect(getFormatterForTool(name)).toBe(formatter);
		expect(getRegisteredTools()).toContain(name);
	});

	it.each(BUILTIN_ADAPTERS)("$name adapter declares detection and output files", ({ adapter }) => {
		expect(adapter.config.detect_files.length).toBeGreaterThan(0);
		expect(adapter.config.output_files.length).toBeGreaterThan(0);
		expect(adapter.config.config_version).toBeGreaterThanOrEqual(1);
	});

	it("every registered tool resolves to an adapter whose formatter is callable", () => {
		for (const tool of getRegisteredTools()) {
			const formatter = getFormatterForTool(tool as "unknown");
			expect(formatter.formatFilesToLoad([])).toBeTypeOf("string");
			expect(formatter.formatExcludes([])).toBeTypeOf("string");
		}
	});
});
