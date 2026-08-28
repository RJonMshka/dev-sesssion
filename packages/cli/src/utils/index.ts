/**
 * CLI utility barrel export.
 *
 * @module
 */

export { createAdapterReadFile, createAdapterWriteFile } from "./adapter-io.js";
export { dryRunGitignorePatch, dryRunMkdir, dryRunSkipWrite, dryRunWrite } from "./dry-run.js";
export { handleError } from "./error-handler.js";
export { resolveAdapter } from "./resolve-adapter.js";
export {
	_resetForTesting,
	installSignalHandlers,
	onCleanup,
} from "./signal-handler.js";
