import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "../index.js";

describe("@dev-session/core", () => {
	it("exports a version placeholder", () => {
		expect(CORE_VERSION).toBe("0.0.0");
	});
});
