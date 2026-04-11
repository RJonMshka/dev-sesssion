import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors.js";

const VALID_TOKENS = new Set(["dev-token", process.env.API_TOKEN].filter(Boolean));

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
	const authHeader = req.headers.authorization;
	if (!authHeader?.startsWith("Bearer ")) {
		throw new AppError(401, "Missing or invalid Authorization header");
	}
	const token = authHeader.slice(7);
	if (!VALID_TOKENS.has(token)) {
		throw new AppError(403, "Invalid token");
	}
	next();
}
