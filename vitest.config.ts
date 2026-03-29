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
				},
			},
			{
				test: {
					name: "integration",
					include: ["tests/**/*.integration.test.ts"],
					environment: "node",
					testTimeout: 30_000,
				},
			},
			{
				test: {
					name: "e2e",
					include: ["tests/**/*.e2e.test.ts"],
					environment: "node",
					testTimeout: 60_000,
				},
			},
		],
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.ts"],
			exclude: ["**/*.test.ts", "**/__tests__/**", "**/index.ts", "**/*.d.ts"],
			thresholds: {
				statements: 80,
				branches: 75,
			},
		},
	},
});
