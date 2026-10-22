/**
 * Reads a target file: a real repository outside this tree, described in JSON
 * (LLD-eval-harness.md, REQ-EVAL-13).
 *
 * `evals/targets/*.local.json` is gitignored, so a private repository can be
 * evaluated without committing its path or contents.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EvalTarget } from "../types.js";

/**
 * Narrows a value to a plain object.
 *
 * @param v - Any value.
 * @returns Whether `v` is a non-null, non-array object.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates one chunk's declared paths.
 *
 * @param key - The chunk id key, for messages.
 * @param value - The raw value.
 * @returns The paths.
 * @throws {Error} If a path is not a string or escapes the target.
 */
function readPaths(key: string, value: unknown): string[] {
	if (!Array.isArray(value)) throw new Error(`expectedFiles["${key}"] must be an array`);
	return value.map((p: unknown) => {
		if (typeof p !== "string") throw new Error(`expectedFiles["${key}"] must hold string paths`);
		const norm = path.posix.normalize(p);
		if (path.posix.isAbsolute(norm) || norm.startsWith("..")) {
			throw new Error(`expectedFiles["${key}"]: "${p}" must be repo-relative`);
		}
		return norm;
	});
}

/**
 * Validates parsed target JSON.
 *
 * @param raw - Parsed JSON.
 * @returns The target, with no ablations: a real repo is evaluated as it is.
 * @throws {Error} On any shape violation.
 */
export function parseTargetFile(raw: unknown): EvalTarget {
	if (!isRecord(raw)) throw new Error("target file must be a JSON object");
	const { id, sourceDir, expectedFiles } = raw;
	if (typeof id !== "string" || id === "") throw new Error("target file needs a string id");
	if (typeof sourceDir !== "string" || sourceDir === "") {
		throw new Error("target file needs a string sourceDir");
	}
	if (!path.isAbsolute(sourceDir)) throw new Error("sourceDir must be an absolute path");

	const expected: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
	if (expectedFiles !== undefined) {
		if (!isRecord(expectedFiles)) throw new Error("expectedFiles must be an object");
		for (const [key, value] of Object.entries(expectedFiles)) {
			if (!/^\d+(\.\d+)?$/.test(key)) throw new Error(`"${key}" is not a chunk id`);
			expected[key] = readPaths(key, value);
		}
	}

	return {
		id,
		sourceDir,
		chunk: 1,
		ablations: [],
		...(expectedFiles === undefined ? {} : { expectedFiles: { ...expected } }),
	};
}

/**
 * Loads and validates a target file from disk.
 *
 * @param file - Path to the JSON file.
 * @returns The target.
 * @throws {Error} If the file cannot be read, parsed, or validated.
 */
export async function loadTargetFile(file: string): Promise<EvalTarget> {
	const text = await fs.readFile(file, "utf8");
	return parseTargetFile(JSON.parse(text) as unknown);
}
