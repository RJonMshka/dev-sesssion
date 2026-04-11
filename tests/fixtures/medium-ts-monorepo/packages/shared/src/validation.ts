import { z } from "zod";

export const UserSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(100),
	email: z.string().email(),
	role: z.enum(["admin", "user"]).default("user"),
	createdAt: z.string().datetime(),
});

export const CreateUserSchema = UserSchema.omit({ id: true, createdAt: true });
export const UpdateUserSchema = CreateUserSchema.partial();

export const OrderSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().uuid(),
	productIds: z.array(z.string().uuid()).min(1),
	total: z.number().positive(),
	status: z.enum(["pending", "confirmed", "shipped", "delivered", "cancelled"]),
	createdAt: z.string().datetime(),
});

export const CreateOrderSchema = OrderSchema.omit({ id: true, createdAt: true, total: true });

export const ProductSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(200),
	description: z.string().max(2000),
	price: z.number().positive(),
	stock: z.number().int().min(0),
	tags: z.array(z.string()).default([]),
});

export const PaginationSchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
