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

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;

// In-memory store for the fixture
export const users = new Map<string, User>();
