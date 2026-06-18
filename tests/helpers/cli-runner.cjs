#!/usr/bin/env node
// Thin wrapper for E2E tests: invokes run() directly from the built CLI.
// The repo dir is named "dev-sesssion", so this wrapper's path matches the
// auto-run heuristic in index.ts (argv[1].includes("dev-sesssion")). Set the
// opt-out flag BEFORE requiring so the module does not also auto-run — we call
// run() exactly once below.
process.env.DEV_SESSSION_NO_AUTORUN = "1";
const { run } = require("../../packages/cli/dist/index.cjs");
run().catch((err) => {
	console.error(err);
	process.exit(1);
});
