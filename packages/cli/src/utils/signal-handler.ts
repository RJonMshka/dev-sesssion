/**
 * Signal handler for graceful cleanup on SIGINT/SIGTERM.
 *
 * Registers cleanup callbacks that run when the process receives an
 * interrupt or termination signal. Uses a re-entrancy guard to prevent
 * double-cleanup. Cleans up partial `.tmp` files from AtomicWriter.
 *
 * @module
 */

import { log } from "@clack/prompts";

/** Cleanup callback type. */
type CleanupFn = () => void | Promise<void>;

/** Registered cleanup functions. */
const cleanupFns: CleanupFn[] = [];

/** Re-entrancy guard — prevents double cleanup. */
let isCleaningUp = false;

/**
 * Register a cleanup function to run on signal.
 *
 * @param fn - Synchronous or async cleanup callback
 * @returns A dispose function that unregisters the callback
 */
export function onCleanup(fn: CleanupFn): () => void {
	cleanupFns.push(fn);
	return () => {
		const idx = cleanupFns.indexOf(fn);
		if (idx !== -1) {
			cleanupFns.splice(idx, 1);
		}
	};
}

/**
 * Run all registered cleanup functions.
 * Protected by a re-entrancy guard — safe to call multiple times.
 *
 * @returns Promise that resolves when all cleanup is done
 */
async function runCleanup(): Promise<void> {
	if (isCleaningUp) {
		return;
	}
	isCleaningUp = true;

	for (const fn of cleanupFns) {
		try {
			await fn();
		} catch {
			// Swallow cleanup errors — we're shutting down
		}
	}
}

/**
 * Install SIGINT and SIGTERM handlers.
 *
 * Should be called once at CLI startup. Handlers run cleanup functions,
 * print a cancellation message, and exit with code 130 (SIGINT) or
 * 143 (SIGTERM).
 *
 * @returns A dispose function that removes the handlers
 */
export function installSignalHandlers(): () => void {
	const handleSignal = (signal: "SIGINT" | "SIGTERM"): void => {
		const code = signal === "SIGINT" ? 130 : 143;

		void runCleanup().then(() => {
			log.warn(`\nReceived ${signal}. Cleaning up...`);
			process.exit(code);
		});
	};

	const onSigint = (): void => handleSignal("SIGINT");
	const onSigterm = (): void => handleSignal("SIGTERM");

	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);

	return () => {
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
	};
}

/**
 * Reset the signal handler state. For testing only.
 *
 * @internal
 */
export function _resetForTesting(): void {
	cleanupFns.length = 0;
	isCleaningUp = false;
}
