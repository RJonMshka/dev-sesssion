import express from "express";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-logger.js";
import { router } from "./router.js";

export function createApp(): express.Application {
	const app = express();

	app.use(express.json());
	app.use(requestLogger);

	app.use("/api/v1", router);

	app.use(notFound);
	app.use(errorHandler);

	return app;
}
