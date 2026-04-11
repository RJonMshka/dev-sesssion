import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("Health route", () => {
	it("GET /health returns ok", async () => {
		const res = await request(createApp()).get("/health");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("ok");
	});
});
