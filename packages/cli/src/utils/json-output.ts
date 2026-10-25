/**
 * Keep stdout clean for a `--json` command whose work also logs prose.
 *
 * clack's `log.*` writes to stdout. A command like `advance` logs from several
 * modules (its own steps, prompt regeneration, the secret scan, the error
 * handler), so threading a quiet flag through all of them would leave one
 * missed call able to corrupt the JSON a harness parses. Instead, while the
 * work runs, stdout writes go to stderr: a person still sees them, and stdout
 * carries exactly one JSON document.
 *
 * @module
 */

/**
 * Run `work` with stdout redirected to stderr.
 *
 * @param work - The command body; anything it writes to stdout goes to stderr.
 * @returns Whatever `work` resolves with.
 * @throws Whatever `work` throws, after stdout is restored.
 */
export async function withStdoutOnStderr<T>(work: () => Promise<T>): Promise<T> {
	const original = process.stdout.write;
	process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
	try {
		return await work();
	} finally {
		process.stdout.write = original;
	}
}

/**
 * Write one JSON document to stdout.
 *
 * @param value - A JSON-serializable value.
 * @returns Nothing.
 */
export function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
