/**
 * CLI utility barrel export.
 *
 * @module
 */

export { dryRunGitignorePatch, dryRunMkdir, dryRunWrite } from "./dry-run.js";
export { handleError } from "./error-handler.js";
export {
	_resetForTesting,
	installSignalHandlers,
	onCleanup,
} from "./signal-handler.js";
