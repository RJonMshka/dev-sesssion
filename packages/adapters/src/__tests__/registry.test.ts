import { DetectedTool, PlainTextFormatter } from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { ClaudeBootstrapFormatter } from "../claude-bootstrap-formatter.js";
import { CursorBootstrapFormatter } from "../cursor-bootstrap-formatter.js";
import { OpencodeBootstrapFormatter } from "../opencode-bootstrap-formatter.js";
import { getFormatterForTool, getRegisteredTools } from "../registry.js";

describe("getFormatterForTool", () => {
	it("returns ClaudeBootstrapFormatter for claude", () => {
		const formatter = getFormatterForTool(DetectedTool.CLAUDE);
		expect(formatter).toBe(ClaudeBootstrapFormatter);
		expect(formatter.name).toBe("claude");
	});

	it("returns OpencodeBootstrapFormatter for opencode", () => {
		const formatter = getFormatterForTool(DetectedTool.OPENCODE);
		expect(formatter).toBe(OpencodeBootstrapFormatter);
		expect(formatter.name).toBe("opencode");
	});

	it("returns CursorBootstrapFormatter for cursor", () => {
		const formatter = getFormatterForTool(DetectedTool.CURSOR);
		expect(formatter).toBe(CursorBootstrapFormatter);
		expect(formatter.name).toBe("cursor");
	});

	it("returns PlainTextFormatter for unknown tools", () => {
		const formatter = getFormatterForTool(DetectedTool.UNKNOWN);
		expect(formatter).toBe(PlainTextFormatter);
		expect(formatter.name).toBe("plain");
	});

	it("returns PlainTextFormatter for unrecognized tool strings", () => {
		// Cast to simulate an unsupported tool value
		const formatter = getFormatterForTool("windsurf" as "unknown");
		expect(formatter).toBe(PlainTextFormatter);
		expect(formatter.name).toBe("plain");
	});

	it("all returned formatters implement BootstrapFormatter interface", () => {
		const tools = [
			DetectedTool.CLAUDE,
			DetectedTool.OPENCODE,
			DetectedTool.CURSOR,
			DetectedTool.UNKNOWN,
		] as const;

		for (const tool of tools) {
			const formatter = getFormatterForTool(tool);
			expect(typeof formatter.name).toBe("string");
			expect(typeof formatter.formatFilesToLoad).toBe("function");
			expect(typeof formatter.formatExcludes).toBe("function");
			expect(typeof formatter.generatePrompt).toBe("function");
		}
	});
});

describe("getRegisteredTools", () => {
	it("returns all four tool identifiers", () => {
		const tools = getRegisteredTools();
		expect(tools).toContain("claude");
		expect(tools).toContain("opencode");
		expect(tools).toContain("cursor");
		expect(tools).toContain("unknown");
	});

	it("returns a readonly array", () => {
		const tools = getRegisteredTools();
		expect(Array.isArray(tools)).toBe(true);
		expect(tools.length).toBe(4);
	});
});
