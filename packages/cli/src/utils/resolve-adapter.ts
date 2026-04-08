/**
 * Adapter resolution utility.
 *
 * Resolves the adapter to use based on: explicit --adapter flag → auto-detect → fallback.
 *
 * @module
 */

import { getAdapterForTool } from "@dev-session/adapters";
import type { Adapter, DetectedToolValue } from "@dev-session/core";
import { DetectedTool, ProjectDetector } from "@dev-session/core";
import { CliError } from "@dev-session/security";

/** Valid adapter names that can be passed via --adapter flag. */
const VALID_ADAPTER_NAMES = new Set(["claude", "opencode", "cursor"]);

/**
 * Resolves the adapter to use for the current project.
 *
 * Resolution order:
 * 1. Explicit `--adapter` flag (if provided and valid)
 * 2. Auto-detect from project files via ProjectDetector
 * 3. Fallback to plain text (unknown tool)
 *
 * @param cwd - Working directory to scan.
 * @param adapterFlag - Optional explicit adapter name from --adapter flag.
 * @returns The resolved adapter and detected tool name.
 * @throws {CliError} If the --adapter flag value is not recognized.
 */
export function resolveAdapter(
	cwd: string,
	adapterFlag?: string,
): { adapter: Adapter; tool: DetectedToolValue; source: "flag" | "detect" | "fallback" } {
	// 1. Explicit flag
	if (adapterFlag !== undefined) {
		if (!VALID_ADAPTER_NAMES.has(adapterFlag)) {
			throw new CliError({
				message: `Unknown adapter: "${adapterFlag}"`,
				suggestion: `Valid adapters: ${[...VALID_ADAPTER_NAMES].join(", ")}`,
			});
		}

		const tool = adapterFlag as DetectedToolValue;
		return { adapter: getAdapterForTool(tool), tool, source: "flag" };
	}

	// 2. Auto-detect
	const detected = ProjectDetector.detect(cwd).tool;
	if (detected !== DetectedTool.UNKNOWN) {
		return { adapter: getAdapterForTool(detected), tool: detected, source: "detect" };
	}

	// 3. Fallback
	return {
		adapter: getAdapterForTool(DetectedTool.UNKNOWN),
		tool: DetectedTool.UNKNOWN,
		source: "fallback",
	};
}
