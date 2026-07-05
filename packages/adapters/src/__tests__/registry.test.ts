import type { Adapter } from "@dev-session/core";
import { CliError, DetectedTool, PlainTextFormatter } from "@dev-session/core";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeAdapter } from "../claude-adapter.js";
import { ClaudeBootstrapFormatter } from "../claude-bootstrap-formatter.js";
import { CursorAdapter } from "../cursor-adapter.js";
import { CursorBootstrapFormatter } from "../cursor-bootstrap-formatter.js";
import { OpencodeAdapter } from "../opencode-adapter.js";
import { OpencodeBootstrapFormatter } from "../opencode-bootstrap-formatter.js";
import {
	getAdapterByName,
	getAdapterForTool,
	getFormatterForTool,
	getRegisteredTools,
	registerAdapter,
	unregisterAdapter,
} from "../registry.js";
import { WindsurfAdapter } from "../windsurf-adapter.js";
import { WindsurfBootstrapFormatter } from "../windsurf-bootstrap-formatter.js";

function makeCustomAdapter(name: string): Adapter {
	return {
		config: {
			name,
			display_name: `Custom (${name})`,
			detect_files: [`.${name}rc`],
			output_files: [`.${name}rc`],
			config_version: 1,
		},
		formatter: PlainTextFormatter,
	};
}

describe("getAdapterForTool", () => {
	it("returns ClaudeAdapter for claude", () => {
		const adapter = getAdapterForTool(DetectedTool.CLAUDE);
		expect(adapter).toBe(ClaudeAdapter);
		expect(adapter.config.name).toBe("claude");
		expect(adapter.formatter).toBe(ClaudeBootstrapFormatter);
	});

	it("returns OpencodeAdapter for opencode", () => {
		const adapter = getAdapterForTool(DetectedTool.OPENCODE);
		expect(adapter).toBe(OpencodeAdapter);
		expect(adapter.config.name).toBe("opencode");
	});

	it("returns CursorAdapter for cursor", () => {
		const adapter = getAdapterForTool(DetectedTool.CURSOR);
		expect(adapter).toBe(CursorAdapter);
		expect(adapter.config.name).toBe("cursor");
	});

	it("returns WindsurfAdapter for windsurf", () => {
		const adapter = getAdapterForTool(DetectedTool.WINDSURF);
		expect(adapter).toBe(WindsurfAdapter);
		expect(adapter.config.name).toBe("windsurf");
		expect(adapter.formatter).toBe(WindsurfBootstrapFormatter);
	});

	it("returns fallback adapter for unknown tools", () => {
		const adapter = getAdapterForTool(DetectedTool.UNKNOWN);
		expect(adapter.config.name).toBe("plain");
		expect(adapter.formatter).toBe(PlainTextFormatter);
		expect(adapter.setup).toBeUndefined();
		expect(adapter.transformState).toBeUndefined();
	});

	it("returns fallback for unrecognized tool strings", () => {
		const adapter = getAdapterForTool("zed" as "unknown");
		expect(adapter.config.name).toBe("plain");
	});

	it("all adapters have lifecycle hooks defined", () => {
		const tools = [
			DetectedTool.CLAUDE,
			DetectedTool.OPENCODE,
			DetectedTool.CURSOR,
			DetectedTool.WINDSURF,
		] as const;

		for (const tool of tools) {
			const adapter = getAdapterForTool(tool);
			expect(typeof adapter.setup).toBe("function");
			expect(typeof adapter.transformState).toBe("function");
			expect(typeof adapter.onSessionStart).toBe("function");
			expect(typeof adapter.onSessionEnd).toBe("function");
		}
	});
});

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

	it("returns WindsurfBootstrapFormatter for windsurf", () => {
		const formatter = getFormatterForTool(DetectedTool.WINDSURF);
		expect(formatter).toBe(WindsurfBootstrapFormatter);
		expect(formatter.name).toBe("windsurf");
	});

	it("returns PlainTextFormatter for unknown tools", () => {
		const formatter = getFormatterForTool(DetectedTool.UNKNOWN);
		expect(formatter).toBe(PlainTextFormatter);
		expect(formatter.name).toBe("plain");
	});

	it("returns PlainTextFormatter for unrecognized tool strings", () => {
		const formatter = getFormatterForTool("zed" as "unknown");
		expect(formatter).toBe(PlainTextFormatter);
		expect(formatter.name).toBe("plain");
	});

	it("all returned formatters implement BootstrapFormatter interface", () => {
		const tools = [
			DetectedTool.CLAUDE,
			DetectedTool.OPENCODE,
			DetectedTool.CURSOR,
			DetectedTool.WINDSURF,
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
	it("returns all five tool identifiers", () => {
		const tools = getRegisteredTools();
		expect(tools).toContain("claude");
		expect(tools).toContain("opencode");
		expect(tools).toContain("cursor");
		expect(tools).toContain("windsurf");
		expect(tools).toContain("unknown");
	});

	it("returns a readonly array", () => {
		const tools = getRegisteredTools();
		expect(Array.isArray(tools)).toBe(true);
		expect(tools.length).toBe(5);
	});
});

describe("registerAdapter", () => {
	afterEach(() => {
		unregisterAdapter("zed");
		unregisterAdapter("my-tool");
	});

	it("registers a custom adapter resolvable by name", () => {
		const zed = makeCustomAdapter("zed");
		registerAdapter(zed);

		expect(getAdapterByName("zed")).toBe(zed);
		expect(getRegisteredTools()).toContain("zed");
	});

	it("makes a custom adapter resolve where the fallback previously applied", () => {
		expect(getAdapterForTool("zed" as "unknown").config.name).toBe("plain");

		registerAdapter(makeCustomAdapter("zed"));
		expect(getAdapterForTool("zed" as "unknown").config.name).toBe("zed");
		expect(getFormatterForTool("zed" as "unknown")).toBe(PlainTextFormatter);
	});

	it("accepts kebab-case names", () => {
		registerAdapter(makeCustomAdapter("my-tool"));
		expect(getAdapterByName("my-tool")?.config.name).toBe("my-tool");
	});

	it.each([
		"",
		"My Tool",
		"UPPER",
		"1tool",
		"-tool",
		"__proto__",
		"tool_x",
		"a/b",
	])("rejects invalid name %j with CliError", (name) => {
		expect(() => registerAdapter(makeCustomAdapter(name))).toThrow(CliError);
		expect(getAdapterByName(name)).toBeUndefined();
	});

	it.each([
		"claude",
		"opencode",
		"cursor",
		"windsurf",
		"unknown",
		"plain",
	])("rejects the reserved name %j", (name) => {
		expect(() => registerAdapter(makeCustomAdapter(name))).toThrow(CliError);
	});

	it("rejects a duplicate custom registration", () => {
		registerAdapter(makeCustomAdapter("zed"));
		expect(() => registerAdapter(makeCustomAdapter("zed"))).toThrow(/already registered/);
	});

	it("does not pollute built-in resolution via prototype-key names", () => {
		expect(getAdapterByName("__proto__")).toBeUndefined();
		expect(getAdapterByName("constructor")).toBeUndefined();
		expect(getAdapterByName("hasOwnProperty")).toBeUndefined();
	});
});

describe("unregisterAdapter", () => {
	it("removes a custom adapter and restores fallback resolution", () => {
		registerAdapter(makeCustomAdapter("zed"));
		expect(unregisterAdapter("zed")).toBe(true);

		expect(getAdapterByName("zed")).toBeUndefined();
		expect(getAdapterForTool("zed" as "unknown").config.name).toBe("plain");
		expect(getRegisteredTools()).not.toContain("zed");
	});

	it("returns false for names that were never registered", () => {
		expect(unregisterAdapter("never-registered")).toBe(false);
	});

	it("cannot remove built-in adapters", () => {
		expect(unregisterAdapter(DetectedTool.CLAUDE)).toBe(false);
		expect(getAdapterForTool(DetectedTool.CLAUDE)).toBe(ClaudeAdapter);
	});
});
