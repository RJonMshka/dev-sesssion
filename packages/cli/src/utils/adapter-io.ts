/**
 * Adapter IO helpers — provides safe read/write functions for adapter contexts.
 *
 * These functions bridge the gap between the adapter interface (which can't
 * depend on @dev-session/security) and the CLI layer (which owns AtomicWriter
 * and PathValidator).
 *
 * @module
 */

import * as fs from "node:fs";
import type { AdapterReadFile, AdapterWriteFile } from "@dev-session/core";
import { AtomicWriter, PathValidator } from "@dev-session/security";

/**
 * Creates an {@link AdapterWriteFile} function backed by AtomicWriter.
 *
 * The returned function resolves relative paths against `projectRoot`
 * using PathValidator, then writes atomically via AtomicWriter.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns A write function safe for use in adapter contexts.
 */
export function createAdapterWriteFile(projectRoot: string): AdapterWriteFile {
	return (relativePath: string, content: string): void => {
		const validated = PathValidator.safeResolvePath(relativePath, projectRoot);
		AtomicWriter.writeFile(validated, content, { skipGuard: true });
	};
}

/**
 * Creates an {@link AdapterReadFile} function that reads from the project root.
 *
 * The returned function resolves relative paths against `projectRoot`
 * using PathValidator. Returns `undefined` if the file does not exist.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns A read function safe for use in adapter contexts.
 */
export function createAdapterReadFile(projectRoot: string): AdapterReadFile {
	return (relativePath: string): string | undefined => {
		try {
			const validated = PathValidator.safeResolvePath(relativePath, projectRoot);
			return fs.readFileSync(validated, "utf-8");
		} catch {
			return undefined;
		}
	};
}
