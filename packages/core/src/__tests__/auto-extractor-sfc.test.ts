/**
 * Single-file components in the ai-index (LLD-sfc-index.md, REQ-SFC-1..5).
 *
 * DevNexus has 7 `.svelte` and 9 `.vue` files; 2.4.2 indexed none of them.
 * Every unit position is checked against the component file itself, since the
 * hash contract is defined over the file's lines, not over an extracted script.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoExtractor } from "../annotation/auto-extractor.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-extractor-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(name: string, content: string): ValidatedPath {
	const p = path.join(tmpDir, name);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content, "utf-8");
	return p as ValidatedPath;
}

/** PROTOCOL.md's unit hash: lines start..end of the file, joined by \n, sha256, 16 hex. */
function fileLinesHash(source: string, start: number, end: number): string {
	const text = source
		.split("\n")
		.slice(start - 1, end)
		.join("\n");
	return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

const VUE = `<template>
  <div class="mfe-incidents__timeline">
    <IncidentCard v-for="i in items" :key="i.id" :incident="i" />
  </div>
</template>

<script lang="ts">
export const TIMELINE_LIMIT = 50;
</script>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ items: { id: string; severity: number }[] }>();

function bySeverity(a: { severity: number }, b: { severity: number }): number {
  return b.severity - a.severity;
}

const sorted = computed(() => [...props.items].sort(bySeverity));
</script>

<style scoped>
.mfe-incidents__timeline { display: grid; }
</style>
`;

const SVELTE = `<script module lang="ts">
  export function formatMetric(value: number): string {
    return value.toFixed(1);
  }
</script>

<script lang="ts">
  let { values } = $props();
  let total = $derived(values.reduce((a, b) => a + b, 0));
</script>

<div class="mfe-metrics__grid">{formatMetric(total)}</div>
`;

describe("AutoExtractor — single-file components", () => {
	it("parses every <script> block of a Vue component (REQ-SFC-1)", () => {
		const r = new AutoExtractor().extractFile(write("Timeline.vue", VUE));
		const ids = r.units.map((u) => u.id);

		expect(ids).toEqual(
			expect.arrayContaining(["TIMELINE_LIMIT", "props", "bySeverity", "sorted"]),
		);
		expect(r.exports.map((s) => s.name)).toEqual(["TIMELINE_LIMIT"]);
	});

	it("reports units at their lines in the component file (REQ-SFC-2)", () => {
		const r = new AutoExtractor().extractFile(write("Timeline.vue", VUE));
		const fn = r.units.find((u) => u.id === "bySeverity");
		const lines = VUE.split("\n");

		expect(fn).toBeDefined();
		expect(lines[(fn?.start ?? 0) - 1]).toContain("function bySeverity");
		for (const u of r.units) {
			expect(u.hash, u.id).toBe(fileLinesHash(VUE, u.start, u.end));
		}
	});

	it("reports a Svelte module export at its file line (REQ-SFC-1, REQ-SFC-2)", () => {
		const r = new AutoExtractor().extractFile(write("MetricsGrid.svelte", SVELTE));
		const fn = r.units.find((u) => u.id === "formatMetric");

		expect(r.exports.map((s) => s.name)).toEqual(["formatMetric"]);
		expect(fn?.start).toBe(2);
		expect(fn?.exported).toBe(true);
		// The instance script's declarations are units too. `let { values }` is
		// destructured, and destructuring yields no unit in any file type.
		expect(r.units.map((u) => u.id)).toEqual(["formatMetric", "total"]);
		for (const u of r.units) {
			expect(u.hash, u.id).toBe(fileLinesHash(SVELTE, u.start, u.end));
		}
	});

	it("parses JSX in a tsx script block (REQ-SFC-3)", () => {
		const src = `<script setup lang="tsx">\nexport const render = () => <div>hi</div>;\n</script>\n`;
		const r = new AutoExtractor().extractFile(write("Render.vue", src));

		expect(r.exports.map((s) => s.name)).toEqual(["render"]);
	});

	it("keeps a script-less component, with a hash and no units (REQ-SFC-4)", () => {
		const src = `<div class="mfe-config__empty">Nothing here</div>\n`;
		const r = new AutoExtractor().extractFile(write("Empty.svelte", src));

		expect(r.exports).toEqual([]);
		expect(r.units).toEqual([]);
		expect(r.hash).toMatch(/^[0-9a-f]{16}$/);
		expect(r.tokenCost).toBeGreaterThan(0);
	});

	it("walks .vue and .svelte files in a directory (REQ-SFC-5)", async () => {
		write("src/Timeline.vue", VUE);
		write("src/MetricsGrid.svelte", SVELTE);
		write("src/main.ts", "export const x = 1;\n");

		const results = await new AutoExtractor().extractDirectory(tmpDir as ValidatedPath);
		const names = results.map((r) => path.basename(r.path)).sort();

		expect(names).toEqual(["MetricsGrid.svelte", "Timeline.vue", "main.ts"]);
	});
});
