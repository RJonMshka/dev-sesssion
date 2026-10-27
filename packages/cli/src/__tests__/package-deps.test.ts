/**
 * The published package depends on no model provider (LLD-offline.md, REQ-OFF-2).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const PKG = path.resolve(import.meta.dirname, "../../package.json");

describe("packages/cli dependencies", () => {
	it("include no model provider SDK (REQ-OFF-2)", () => {
		const pkg = JSON.parse(fs.readFileSync(PKG, "utf-8")) as {
			dependencies?: Record<string, string>;
		};
		const names = Object.keys(pkg.dependencies ?? {});
		for (const sdk of ["@anthropic-ai/sdk", "openai", "@google/generative-ai"]) {
			expect(names).not.toContain(sdk);
		}
	});
});
