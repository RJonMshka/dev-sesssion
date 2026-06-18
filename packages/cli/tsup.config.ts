import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	tsconfig: "tsconfig.build.json",
	dts: true,
	splitting: false,
	sourcemap: true,
	clean: true,
	// Inject import.meta.url in the CJS output (and __dirname/__filename in ESM) so
	// cli.ts can resolve its own package.json at runtime to read the version.
	shims: true,
	// Bundle workspace packages into the CLI distribution so only one artifact is published to npm
	noExternal: ["@dev-session/core", "@dev-session/security", "@dev-session/adapters"],
	banner({ format }) {
		if (format === "cjs") {
			return { js: "#!/usr/bin/env node" };
		}
		return {};
	},
	outExtension({ format }) {
		return {
			js: format === "esm" ? ".mjs" : ".cjs",
		};
	},
});
