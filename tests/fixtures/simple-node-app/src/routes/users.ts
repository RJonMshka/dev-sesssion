import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { CreateUserSchema, UpdateUserSchema, users } from "../models/user.js";
import { AppError } from "../utils/errors.js";
import { parseBody } from "../utils/validate.js";

export const userRouter = Router();

userRouter.get("/", requireAuth, (_req, res) => {
	res.json({ users: Array.from(users.values()) });
});

userRouter.post("/", requireAuth, (req, res) => {
	const body = parseBody(CreateUserSchema, req.body);
	const user = {
		id: randomUUID(),
		createdAt: new Date().toISOString(),
		...body,
	};
	users.set(user.id, user);
	res.status(201).json({ user });
});

userRouter.put("/:id", requireAuth, (req, res) => {
	const { id } = req.params;
	if (!id || !users.has(id)) {
		throw new AppError(404, "User not found");
	}
	const body = parseBody(UpdateUserSchema, req.body);
	const existing = users.get(id);
	if (!existing) throw new AppError(404, "User not found");
	const updated = { ...existing, ...body };
	users.set(id, updated);
	res.json({ user: updated });
});

userRouter.delete("/:id", requireAuth, (req, res) => {
	const { id } = req.params;
	if (!id || !users.delete(id)) {
		throw new AppError(404, "User not found");
	}
	res.status(204).send();
});
