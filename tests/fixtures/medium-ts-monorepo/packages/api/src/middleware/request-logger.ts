import { logger } from "@fixture/config";
import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
	const start = Date.now();
	res.on("finish", () => {
		logger.info(`${req.method} ${req.path}`, {
			status: res.statusCode,
			durationMs: Date.now() - start,
		});
	});
	next();
}
