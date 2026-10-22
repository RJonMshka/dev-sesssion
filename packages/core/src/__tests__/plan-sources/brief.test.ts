/**
 * A chunk's brief: its plan section without the task lines
 * (LLD-prompt-context.md, REQ-PCX-1..3).
 *
 * Shaped like a DevNexus phase, where the checkboxes are a Definition of Done
 * and the work is a numbered list the agent never saw.
 */

import { describe, expect, it } from "vitest";
import { extractBrief, MAX_BRIEF_CHARS } from "../../parsers/plan-sources/brief.js";
import { scanLines } from "../../parsers/plan-sources/markdown-utils.js";

const brief = (text: string): string | undefined => extractBrief(scanLines(text));

const PHASE = `**Goal**: pnpm + Turbo workspace with a React shell.
**Duration**: ~3–4 hours

### Tasks
1. Initialize pnpm workspace + Turborepo
   \`\`\`
   pnpm init
   - [ ] not a task, inside a fence
   \`\`\`
2. Scaffold \`apps/shell\` with Vite + React 18

### Definition of Done
- [ ] \`pnpm dev\` runs shell on localhost:3000
- [x] Sidebar links navigate

### Key Files
\`\`\`
apps/shell/src/App.tsx
\`\`\`
`;

describe("extractBrief", () => {
	it("keeps the goal, the numbered steps and the file list, without checkboxes (REQ-PCX-1)", () => {
		const b = brief(PHASE) ?? "";

		expect(b).toContain("**Goal**: pnpm + Turbo workspace with a React shell.");
		expect(b).toContain("1. Initialize pnpm workspace + Turborepo");
		expect(b).toContain("2. Scaffold `apps/shell` with Vite + React 18");
		expect(b).toContain("apps/shell/src/App.tsx");
		expect(b).not.toContain("runs shell on localhost:3000");
		expect(b).not.toContain("Sidebar links navigate");
		// A checkbox inside a fence is code, not a task.
		expect(b).toContain("- [ ] not a task, inside a fence");
	});

	it("drops a heading the removed tasks leave empty, keeps the others (REQ-PCX-2)", () => {
		const b = brief(PHASE) ?? "";

		expect(b).not.toContain("### Definition of Done");
		expect(b).toContain("### Tasks");
		expect(b).toContain("### Key Files");
	});

	it("drops the rule a plan puts between sections, keeps one inside (REQ-PCX-2)", () => {
		const b = brief("---\n**Goal**: x\n\n---\n\nMore text\n\n---\n") ?? "";

		expect(b).toBe("**Goal**: x\n\n---\n\nMore text");
	});

	it("is undefined for a section that is only tasks (REQ-PCX-1)", () => {
		expect(brief("- [ ] one\n- [ ] two\n")).toBeUndefined();
		expect(brief("### Definition of Done\n- [ ] one\n\n")).toBeUndefined();
	});

	it("cuts a long section at a line, and says so (REQ-PCX-3)", () => {
		const long = Array.from({ length: 400 }, (_, i) => `Step ${String(i)}: ${"x".repeat(40)}`).join(
			"\n",
		);
		const b = brief(long) ?? "";
		const lines = b.split("\n");

		expect(b.length).toBeLessThanOrEqual(MAX_BRIEF_CHARS);
		expect(lines.at(-1)).toMatch(/shortened/);
		// Every kept line is a whole line of the original.
		for (const line of lines.slice(0, -2)) expect(long.split("\n")).toContain(line);
	});
});
