#!/usr/bin/env node
// Thin wrapper for E2E tests: invokes run() directly from the built CLI.
// IMPORTANT: this file must NOT be named "dev-session.*" — the auto-run
// heuristic in index.ts checks process.argv[1].includes("dev-session"), which
// would trigger a second run() call when the module is required.
const { run } = require("../../packages/cli/dist/index.cjs");
run().catch((err) => {
	console.error(err);
	process.exit(1);
});
