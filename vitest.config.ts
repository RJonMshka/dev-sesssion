import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/__tests__/**/*.test.ts"],
					exclude: ["**/integration/**", "**/e2e/**"],
					environment: "node",
					// Repo dir is "dev-sesssion", so importing the CLI entry in-process
					// trips its auto-run heuristic. Opt out; tests call run() explicitly.
					env: { DEV_SESSSION_NO_AUTORUN: "1" },
				},
			},
			{
				test: {
					name: "integration",
					include: ["tests/**/*.integration.test.ts"],
					environment: "node",
					testTimeout: 30_000,
					env: { DEV_SESSSION_NO_AUTORUN: "1" },
				},
			},
			{
				test: {
					name: "e2e",
					include: ["tests/**/*.e2e.test.ts"],
					environment: "node",
					testTimeout: 60_000,
					globalSetup: ["tests/setup/e2e-global-setup.ts"],
				},
			},
		],
		coverage: {
			// In-process coverage only (unit + integration). Subprocess-tested
			// CLI code is collected separately via c8 over NODE_V8_COVERAGE and
			// merged by tests/coverage/merge-coverage.mjs, which enforces the
			// 80% statement / 75% branch thresholds on the combined map.
			provider: "v8",
			include: ["packages/*/src/**/*.ts"],
			exclude: ["**/*.test.ts", "**/__tests__/**", "**/index.ts", "**/*.d.ts"],
			reporter: ["text-summary", "json"],
			reportsDirectory: "coverage/unit",
		},
	},
});
