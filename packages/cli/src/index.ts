/**
 * dev-session CLI
 *
 * Thin wrapper over @dev-session/core.
 * Parse args -> call core -> format output -> exit.
 *
 * @packageDocumentation
 */

/** Placeholder — CLI entry point will be implemented in Chunk 4. */
export function main(): void {
	// Will use commander + @clack/prompts
	process.stdout.write("dev-session v0.0.0\n");
}

// Auto-run when executed directly
const isDirectRun = typeof process !== "undefined" && process.argv[1]?.includes("dev-session");
if (isDirectRun) {
	main();
}
