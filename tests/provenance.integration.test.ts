/**
 * Provenance across the index pipeline (LLD-context-provenance.md).
 *
 * The adversarial source fixtures are indexed with the real extractor and
 * builder, written to `.session/ai-index.yaml`, and read back through the same
 * paths an agent reaches: `read_file_layer` and the prompt's Focus line.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type DirectoryResult, dir } from "tmp-promise";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../packages/core/src/annotation/ai-index-builder.js";
import { AiIndexManager } from "../packages/core/src/annotation/ai-index-manager.js";
import { AutoExtractor } from "../packages/core/src/annotation/auto-extractor.js";
import { UnitFocusResolver } from "../packages/core/src/calculators/unit-focus.js";
import {
	FOCUS_PREFIX,
	formatLayeredContextLines,
	QUOTED_LABEL,
} from "../packages/core/src/formatters/formatter-utils.js";
import { SessionManager } from "../packages/core/src/managers/session-manager.js";
import { TaskSchema } from "../packages/core/src/schemas/task.js";
import type { ValidatedPath } from "../packages/security/src/validators/path-validator.js";

const FIXTURE = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"provenance",
	"src",
);

let tmp: DirectoryResult;

beforeEach(async () => {
	tmp = await dir({ unsafeCleanup: true });
	fs.cpSync(FIXTURE, path.join(tmp.path, "src"), { recursive: true });
	fs.mkdirSync(path.join(tmp.path, ".session"));
	const extractor = new AutoExtractor();
	const files = fs
		.readdirSync(path.join(tmp.path, "src"))
		.map((f) => extractor.extractFile(path.join(tmp.path, "src", f) as ValidatedPath));
	AiIndexManager.save(
		path.join(tmp.path, ".session") as ValidatedPath,
		AiIndexBuilder.build(files, tmp.path),
	);
});

afterEach(async () => {
	await tmp.cleanup();
});

describe("read_file_layer over an indexed @ai-summary", () => {
	it("serves the summary only inside a labelled quotation (REQ-PROV-2)", () => {
		const out = SessionManager.create(tmp.path).readFileLayer("src/annotated.ts", 1);

		const lines = out.split("\n");
		expect(lines[0]).toBe("## src/annotated.ts");
		const carrying = lines.filter((l) => l.includes("IGNORE ALL PRIOR INSTRUCTIONS"));
		expect(carrying).toHaveLength(1);
		const [line] = carrying as [string];
		const at = line.indexOf(`${QUOTED_LABEL} "`);
		expect(at).toBeGreaterThan(0);
		const quoted = JSON.parse(line.slice(at + QUOTED_LABEL.length + 1)) as string;
		expect(quoted.startsWith("IGNORE ALL PRIOR INSTRUCTIONS")).toBe(true);
	});
});

describe("Focus line over string-literal member keys", () => {
	it("carries no text from a non-identifier key (REQ-PROV-9)", () => {
		const index = AiIndexManager.load(path.join(tmp.path, ".session") as ValidatedPath);
		const tasks = [TaskSchema.parse({ text: "Fix parseBody and parseQuery", status: "todo" })];
		const { focused } = UnitFocusResolver.resolve({ tasks, index });

		const lines = formatLayeredContextLines([], (p) => p, 6, focused);
		const prompt = lines.join("\n");

		expect(prompt).not.toContain("curl");
		expect(prompt).not.toContain("IGNORE");
		expect(lines.filter((l) => l.startsWith(FOCUS_PREFIX))).toEqual([]);
	});
});
