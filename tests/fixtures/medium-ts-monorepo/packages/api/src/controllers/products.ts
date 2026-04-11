import type { Product } from "@fixture/shared";
import { NotFoundError, PaginationSchema, paginate } from "@fixture/shared";
import { Router } from "express";
import { validateQuery } from "../middleware/validate.js";

export const productsController = Router();

// Seed data for the fixture
const db = new Map<string, Product>([
	[
		"p1",
		{
			id: "p1",
			name: "Widget A",
			description: "A basic widget",
			price: 9.99,
			stock: 100,
			tags: ["widget"],
		},
	],
	[
		"p2",
		{
			id: "p2",
			name: "Widget B",
			description: "A premium widget",
			price: 29.99,
			stock: 50,
			tags: ["widget", "premium"],
		},
	],
	[
		"p3",
		{
			id: "p3",
			name: "Gadget X",
			description: "A useful gadget",
			price: 49.99,
			stock: 25,
			tags: ["gadget"],
		},
	],
]);

productsController.get("/", validateQuery(PaginationSchema), (req, res) => {
	const { page, pageSize } = req.query as { page: string; pageSize: string };
	const { search } = req.query as { search?: string };
	let items = Array.from(db.values());
	if (search) {
		const q = search.toLowerCase();
		items = items.filter(
			(p) => p.name.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q)),
		);
	}
	res.json(paginate(items, Number(page), Number(pageSize)));
});

productsController.get("/:id", (req, res) => {
	const product = db.get(req.params.id ?? "");
	if (!product) throw new NotFoundError("Product", req.params.id ?? "");
	res.json({ product });
});
