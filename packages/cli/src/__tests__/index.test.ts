import { describe, expect, it } from "vitest";
import { main } from "../index.js";

describe("dev-session CLI", () => {
	it("exports a main function", () => {
		expect(typeof main).toBe("function");
	});
});
