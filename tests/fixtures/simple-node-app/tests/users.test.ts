import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { users } from "../src/models/user.js";

const AUTH = { Authorization: "Bearer dev-token" };

describe("User routes", () => {
	beforeEach(() => users.clear());

	it("GET /users returns empty list initially", async () => {
		const res = await request(createApp()).get("/users").set(AUTH);
		expect(res.status).toBe(200);
		expect(res.body.users).toEqual([]);
	});

	it("POST /users creates a user", async () => {
		const res = await request(createApp())
			.post("/users")
			.set(AUTH)
			.send({ name: "Alice", email: "alice@example.com" });
		expect(res.status).toBe(201);
		expect(res.body.user.name).toBe("Alice");
	});

	it("DELETE /users/:id returns 404 for unknown id", async () => {
		const res = await request(createApp()).delete("/users/unknown-id").set(AUTH);
		expect(res.status).toBe(404);
	});

	it("GET /users returns 401 without auth", async () => {
		const res = await request(createApp()).get("/users");
		expect(res.status).toBe(401);
	});
});
