import { describe, expect, it } from "vitest";
import { SECURITY_VERSION } from "../index.js";

describe("@dev-session/security", () => {
	it("exports a version placeholder", () => {
		expect(SECURITY_VERSION).toBe("0.0.0");
	});
});
