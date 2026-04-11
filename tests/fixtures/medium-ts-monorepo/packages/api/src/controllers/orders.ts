import { randomUUID } from "node:crypto";
import type { Order } from "@fixture/shared";
import { CreateOrderSchema, NotFoundError, PaginationSchema, paginate } from "@fixture/shared";
import { Router } from "express";
import { validateBody, validateQuery } from "../middleware/validate.js";

export const ordersController = Router();

const db = new Map<string, Order>();

ordersController.get("/", validateQuery(PaginationSchema), (req, res) => {
	const { page, pageSize } = req.query as { page: string; pageSize: string };
	res.json(paginate(Array.from(db.values()), Number(page), Number(pageSize)));
});

ordersController.get("/:id", (req, res) => {
	const order = db.get(req.params.id ?? "");
	if (!order) throw new NotFoundError("Order", req.params.id ?? "");
	res.json({ order });
});

ordersController.post("/", validateBody(CreateOrderSchema), (req, res) => {
	const order: Order = {
		id: randomUUID(),
		total: 0,
		status: "pending",
		createdAt: new Date().toISOString(),
		...req.body,
	};
	db.set(order.id, order);
	res.status(201).json({ order });
});
