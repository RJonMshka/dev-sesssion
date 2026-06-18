import { describe, expect, it } from "vitest";
import { createProgram, handleError, installSignalHandlers, onCleanup, run } from "../index.js";

describe("dev-sesssion CLI", () => {
	it("exports createProgram function", () => {
		expect(typeof createProgram).toBe("function");
	});

	it("exports run function", () => {
		expect(typeof run).toBe("function");
	});

	it("exports handleError function", () => {
		expect(typeof handleError).toBe("function");
	});

	it("exports installSignalHandlers function", () => {
		expect(typeof installSignalHandlers).toBe("function");
	});

	it("exports onCleanup function", () => {
		expect(typeof onCleanup).toBe("function");
	});
});
