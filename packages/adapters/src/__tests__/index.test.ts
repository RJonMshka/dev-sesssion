import { describe, expect, it } from "vitest";
import {
	ClaudeBootstrapFormatter,
	CursorBootstrapFormatter,
	getFormatterForTool,
	getRegisteredTools,
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

	it("exports getFormatterForTool", () => {
		expect(typeof getFormatterForTool).toBe("function");
	});

	it("exports getRegisteredTools", () => {
		expect(typeof getRegisteredTools).toBe("function");
	});
});
