import { describe, expect, it } from "vitest";
import { ADAPTERS_VERSION } from "../index.js";

describe("@dev-session/adapters", () => {
	it("exports a version placeholder", () => {
		expect(ADAPTERS_VERSION).toBe("0.0.0");
	});
});
