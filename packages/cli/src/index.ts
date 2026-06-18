/**
 * dev-sesssion CLI
 *
 * Thin wrapper over @dev-session/core.
 * Parse args -> call core -> format output -> exit.
 *
 * @packageDocumentation
 */

export { createProgram, run } from "./cli.js";
export type { AdvanceOptions, AdvanceResult } from "./commands/advance.js";
export type { IndexAddOptions, IndexAuditOptions } from "./commands/index-cmd.js";
export type { InitOptions } from "./commands/init.js";
export type { PromptOptions } from "./commands/prompt.js";
export type { StatusJson, StatusOptions } from "./commands/status.js";
export type { UpdateOptions, UpdateResult } from "./commands/update.js";
export {
	dryRunGitignorePatch,
	dryRunMkdir,
	dryRunWrite,
	handleError,
	installSignalHandlers,
	onCleanup,
} from "./utils/index.js";

// Auto-run when executed directly.
// The path check matches the installed binary (node_modules/dev-sesssion/...).
// E2E tests require this module from inside the repo (also named "dev-sesssion"),
// so the wrapper sets DEV_SESSSION_NO_AUTORUN to call run() itself exactly once.
const isDirectRun =
	typeof process !== "undefined" &&
	!process.env.DEV_SESSSION_NO_AUTORUN &&
	process.argv[1]?.includes("dev-sesssion");
if (isDirectRun) {
	void import("./cli.js").then(({ run: runCli }) => runCli());
}
