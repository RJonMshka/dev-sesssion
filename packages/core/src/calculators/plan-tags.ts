/**
 * Plan tags — which files `init` tags to which chunks (LLD-file-index.md,
 * LLD-first-run.md, LLD-tagging.md REQ-IDX-42).
 *
 * A file is tagged to every chunk whose unfinished task or `files` list names
 * it, and to nothing else. Where a file sits is never evidence (REQ-IDX-43).
 *
 * @packageDocumentation
 */

import * as path from "node:path";
import type { FileIndexEntry, PlanChunk, WalkedFile } from "../schemas/index.js";
import { GitignoreAwareWalker } from "../walkers/gitignore-aware-walker.js";
import { referencedFiles } from "./file-reference.js";

/** Tags files from the plan. */
export const PlanTags = {
	/**
	 * Builds one entry per walked file the plan names — in an unfinished task,
	 * or in an unfinished chunk's `files` — tagged to every chunk that names it
	 * (REQ-RUN-1, REQ-IDX-17). Files the plan never names get no entry
	 * (REQ-RUN-4): the ai-index still reaches them.
	 *
	 * @param files - Walked files.
	 * @param chunks - The plan's chunks.
	 * @param alwaysInclude - Paths already present as always-include entries.
	 * @returns The tagged entries, in walk order.
	 */
	fromPlan(
		files: readonly WalkedFile[],
		chunks: readonly PlanChunk[],
		alwaysInclude: ReadonlySet<string>,
	): FileIndexEntry[] {
		const refs = referencedFiles(
			chunks,
			files.map((f) => f.relativePath),
		);
		const tagged: FileIndexEntry[] = [];
		for (const file of files) {
			const chunkTags = refs.get(file.relativePath);
			if (chunkTags === undefined || alwaysInclude.has(file.relativePath)) continue;
			tagged.push({
				filepath: file.relativePath,
				chunk_tags: chunkTags,
				purpose: inferPurpose(file.relativePath),
				token_cost: GitignoreAwareWalker.estimateTokenCost(file),
			});
		}
		return tagged;
	},
} as const;

/**
 * Infer a short purpose description from a file path.
 *
 * @param filepath - The relative file path.
 * @returns A short purpose string.
 */
export function inferPurpose(filepath: string): string {
	const base = path.basename(filepath);
	const ext = path.extname(filepath);
	const dir = path.dirname(filepath);

	if (base === "package.json") return "Package manifest";
	if (base === "tsconfig.json") return "TypeScript config";
	if (base === "tsconfig.build.json") return "Build-only TypeScript config";
	if (base === "tsup.config.ts") return "Build config";
	if (base === "vitest.config.ts") return "Test config";
	if (base === "biome.json") return "Linter/formatter config";
	if (base === ".npmrc") return "npm/pnpm settings";
	if (base === ".nvmrc") return "Node version";
	if (base === ".gitignore") return "Git ignore rules";
	if (base === "README.md") return "Documentation";
	if (base === "CHANGELOG.md") return "Change log";
	if (base === "LICENSE") return "License file";

	if (base.endsWith(".test.ts") || base.endsWith(".spec.ts")) {
		return `Tests for ${base.replace(/\.(test|spec)\.ts$/, "")}`;
	}

	if (ext === ".ts" || ext === ".tsx") {
		if (base === "index.ts" || base === "index.tsx") {
			return `${dir === "." ? "Root" : dir} entry point`;
		}
		return `${base.replace(ext, "")} module`;
	}

	if (ext === ".md") return "Documentation";
	if (ext === ".json") return "Configuration";
	if (ext === ".yml" || ext === ".yaml") return "Configuration";

	return "Project file";
}
