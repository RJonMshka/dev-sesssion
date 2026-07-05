/**
 * Adapter resolution utility.
 *
 * Resolves the adapter to use based on: explicit --adapter flag → auto-detect → fallback.
 *
 * @module
 */

import { getAdapterByName, getAdapterForTool, getRegisteredTools } from "@dev-session/adapters";
import type { Adapter, DetectedToolValue } from "@dev-session/core";
import { DetectedTool, ProjectDetector } from "@dev-session/core";
import { CliError } from "@dev-session/security";

/**
 * Adapter names accepted by the --adapter flag: everything in the registry
 * (built-in and custom) except the internal "unknown" fallback key.
 *
 * Derived from the registry so a newly registered adapter is automatically
 * a valid flag value — no second hand-maintained list to forget.
 *
 * @returns The accepted adapter names.
 */
function validAdapterNames(): readonly string[] {
	return getRegisteredTools().filter((name) => name !== DetectedTool.UNKNOWN);
}

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
		const adapter =
			adapterFlag === DetectedTool.UNKNOWN ? undefined : getAdapterByName(adapterFlag);
		if (adapter === undefined) {
			throw new CliError({
				message: `Unknown adapter: "${adapterFlag}"`,
				suggestion: `Valid adapters: ${validAdapterNames().join(", ")}`,
			});
		}

		return { adapter, tool: adapterFlag as DetectedToolValue, source: "flag" };
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
