/**
 * dev-session CLI
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

// Auto-run when executed directly
const isDirectRun = typeof process !== "undefined" && process.argv[1]?.includes("dev-session");
if (isDirectRun) {
	void import("./cli.js").then(({ run: runCli }) => runCli());
}
