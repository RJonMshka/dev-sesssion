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
} from "../index.js";

describe("@dev-session/adapters", () => {
	it("exports ClaudeBootstrapFormatter", () => {
		expect(ClaudeBootstrapFormatter).toBeDefined();
		expect(ClaudeBootstrapFormatter.name).toBe("claude");
	});

	it("exports OpencodeBootstrapFormatter", () => {
		expect(OpencodeBootstrapFormatter).toBeDefined();
		expect(OpencodeBootstrapFormatter.name).toBe("opencode");
	});

	it("exports CursorBootstrapFormatter", () => {
		expect(CursorBootstrapFormatter).toBeDefined();
		expect(CursorBootstrapFormatter.name).toBe("cursor");
	});

	it("exports ClaudeAdapter", () => {
		expect(ClaudeAdapter).toBeDefined();
		expect(ClaudeAdapter.config.name).toBe("claude");
	});

	it("exports OpencodeAdapter", () => {
		expect(OpencodeAdapter).toBeDefined();
		expect(OpencodeAdapter.config.name).toBe("opencode");
	});

	it("exports CursorAdapter", () => {
		expect(CursorAdapter).toBeDefined();
		expect(CursorAdapter.config.name).toBe("cursor");
	});

	it("exports getFormatterForTool", () => {
		expect(typeof getFormatterForTool).toBe("function");
	});

	it("exports getAdapterForTool", () => {
		expect(typeof getAdapterForTool).toBe("function");
	});

	it("exports getRegisteredTools", () => {
		expect(typeof getRegisteredTools).toBe("function");
	});
});
