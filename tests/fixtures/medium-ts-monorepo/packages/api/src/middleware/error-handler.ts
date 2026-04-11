import { logger } from "@fixture/config";
import { DomainError } from "@fixture/shared";
import type { NextFunction, Request, Response } from "express";

export function errorHandler(
	err: unknown,
	_req: Request,
	res: Response,
	_next: NextFunction,
): void {
	if (err instanceof DomainError) {
		res.status(err.statusCode).json({ error: err.message, code: err.code });
		return;
	}
	logger.error("Unexpected error", { err: String(err) });
	res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
}
