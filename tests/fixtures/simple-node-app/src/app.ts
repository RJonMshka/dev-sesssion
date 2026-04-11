import express from "express";
import { errorHandler } from "./middleware/errors.js";
import { requestLogger } from "./middleware/logger.js";
import { healthRouter } from "./routes/health.js";
import { userRouter } from "./routes/users.js";

export function createApp(): express.Application {
	const app = express();

	app.use(express.json());
	app.use(requestLogger);

	app.use("/users", userRouter);
	app.use("/health", healthRouter);

	app.use(errorHandler);

	return app;
}
