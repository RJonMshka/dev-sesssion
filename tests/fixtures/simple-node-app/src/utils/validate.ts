import type { ZodSchema } from "zod";
import { AppError } from "./errors.js";

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
	const result = schema.safeParse(body);
	if (!result.success) {
		const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
		throw new AppError(400, `Validation failed: ${messages.join(", ")}`);
	}
	return result.data;
}
