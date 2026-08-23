/**
 * Eval targets and their ablations.
 *
 * Fixtures ship with their chunk-1 work already written, so a cold agent cannot
 * be asked to "do chunk 1" as-is. Each ablation deletes a file to reopen a slice
 * of that work; the deleted file is the ground truth the run is scored against.
 *
 * @module
 */

import type { EvalTarget } from "./types.js";

/** Targets the harness runs. Real OSS repos join this list once fixtures are green. */
export const TARGETS: readonly EvalTarget[] = [
	{
		id: "simple-node-app",
		sourceDir: "tests/fixtures/simple-node-app",
		chunk: 1,
		ablations: [
			{
				id: "auth-middleware",
				description: "Restore the JWT-style auth middleware deleted from the Express app.",
				// PLAN.md says "(JWT)", but the reference is a token-set check, not JWT —
				// the fixture contradicts itself. Grading against the reference while
				// telling the agent "JWT" guarantees a mismatch, so the misleading
				// qualifier is dropped. The real contract is discoverable from
				// tests/users.test.ts, which is the point of the ablation.
				task: "Add authentication middleware",
				removeFiles: ["src/middleware/auth.ts"],
				contract:
					"Exports `requireAuth(req, res, next)`. Rejects a missing or non-`Bearer ` " +
					"Authorization header with AppError(401). Accepts the literal token `dev-token` " +
					"and `process.env.API_TOKEN`; any other token is AppError(403). Calls next() on success.",
			},
			{
				id: "body-validation",
				description: "Restore the Zod request-body validation helper.",
				task: "Add request validation with Zod",
				removeFiles: ["src/utils/validate.ts"],
				contract:
					"Exports `parseBody<T>(schema, body): T`. Returns parsed data on success; on failure " +
					"throws AppError(400) whose message lists each issue as `path: message`, comma-joined.",
			},
		],
	},
];
