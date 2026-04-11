import { ValidationError } from "@fixture/shared";
import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

export function validateBody(schema: ZodSchema) {
	return (req: Request, _res: Response, next: NextFunction): void => {
		const result = schema.safeParse(req.body);
		if (!result.success) {
			const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
			next(new ValidationError(msg));
			return;
		}
		req.body = result.data;
		next();
	};
}

export function validateQuery(schema: ZodSchema) {
	return (req: Request, _res: Response, next: NextFunction): void => {
		const result = schema.safeParse(req.query);
		if (!result.success) {
			const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
			next(new ValidationError(msg));
			return;
		}
		req.query = result.data as typeof req.query;
		next();
	};
}
