import { randomUUID } from "node:crypto";
import type { User } from "@fixture/shared";
import {
	CreateUserSchema,
	NotFoundError,
	PaginationSchema,
	paginate,
	UpdateUserSchema,
} from "@fixture/shared";
import { Router } from "express";
import { validateBody, validateQuery } from "../middleware/validate.js";

export const usersController = Router();

const db = new Map<string, User>();

usersController.get("/", validateQuery(PaginationSchema), (req, res) => {
	const { page, pageSize } = req.query as { page: string; pageSize: string };
	const result = paginate(Array.from(db.values()), Number(page), Number(pageSize));
	res.json(result);
});

usersController.get("/:id", (req, res) => {
	const user = db.get(req.params.id ?? "");
	if (!user) throw new NotFoundError("User", req.params.id ?? "");
	res.json({ user });
});

usersController.post("/", validateBody(CreateUserSchema), (req, res) => {
	const user: User = { id: randomUUID(), createdAt: new Date().toISOString(), ...req.body };
	db.set(user.id, user);
	res.status(201).json({ user });
});

usersController.put("/:id", validateBody(UpdateUserSchema), (req, res) => {
	const id = req.params.id ?? "";
	const existing = db.get(id);
	if (!existing) throw new NotFoundError("User", id);
	const updated = { ...existing, ...req.body };
	db.set(id, updated);
	res.json({ user: updated });
});

usersController.delete("/:id", (req, res) => {
	const id = req.params.id ?? "";
	if (!db.delete(id)) throw new NotFoundError("User", id);
	res.status(204).send();
});
