/**
 * Usage facts — the evidence used to tell apart declarations that share a name
 * (LLD-code-units.md, REQ-UNIT-31, REQ-UNIT-34).
 *
 * Every assertion is on what `AutoExtractor.extractFile` emits for real files.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { ParsedFile } from "../annotation/types.js";

const UTILS = `export function shared(): void {}

function privateUsed(): void {}

function privateDead(): void {}

export function caller(): void {
  privateUsed();
}

function shadowed(): number {
  return 1;
}

function user(shadowed: number): number {
  return shadowed;
}

export const Api = {
  load(): void {
    this.save();
  },
  save(): void {},
  unused(): void {},
};

Api.load();

export class Box {
  open(): void {
    this.close();
  }
  close(): void {}
}

function helper2(): void {}
export { helper2 };

type Local = string;
export type Uses = Local;
`;

const CONSUMER = `import { shared, Api as A } from "./utils.js";
import * as U from "./utils.js";
import { thing } from "@scope/pkg";
import { gone } from "./missing.js";
export { caller } from "./utils.js";

shared();
A.unused();
U.privateDead;
thing(gone);
`;

let root: string;
let utils: ParsedFile;
let consumer: ParsedFile;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-extractor-"));
	fs.mkdirSync(path.join(root, "src"));
	fs.writeFileSync(path.join(root, "src", "utils.ts"), UTILS);
	fs.writeFileSync(path.join(root, "src", "consumer.ts"), CONSUMER);
	const extractor = new AutoExtractor();
	utils = extractor.extractFile(path.join(root, "src", "utils.ts") as ValidatedPath);
	consumer = extractor.extractFile(path.join(root, "src", "consumer.ts") as ValidatedPath);
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** A unit's in-file reference count. */
function refs(id: string): number | undefined {
	return utils.units.find((u) => u.id === id)?.refs;
}

describe("in-file references (REQ-UNIT-31)", () => {
	it("counts a call to a private function in its own file", () => {
		expect(refs("privateUsed")).toBe(1);
	});

	it("counts nothing for a function nobody in the file references", () => {
		expect(refs("privateDead")).toBe(0);
		expect(refs("shared")).toBe(0);
	});

	it("counts nothing when an inner binding could capture the name", () => {
		// `user(shadowed)` reads its parameter, not the function: uncertain, so 0.
		expect(refs("shadowed")).toBe(0);
	});

	it("counts `Parent.member` and `this.member` for object and class members", () => {
		expect(refs("Api.load")).toBe(1);
		expect(refs("Api.save")).toBe(1);
		expect(refs("Api.unused")).toBe(0);
		expect(refs("Box.close")).toBe(1);
		expect(refs("Box.open")).toBe(0);
	});

	it("counts a type referenced by another type", () => {
		expect(refs("Local")).toBe(1);
	});
});

describe("what does not count as use (REQ-UNIT-31)", () => {
	/** Extracts one file and returns a unit's refs. */
	function refsIn(source: string, id: string): number | undefined {
		const file = path.join(root, "src", "extra.ts");
		fs.writeFileSync(file, source);
		return new AutoExtractor().extractFile(file as ValidatedPath).units.find((u) => u.id === id)
			?.refs;
	}

	it("does not count `export { name }` as a use", () => {
		expect(refs("helper2")).toBe(0);
	});

	it("does not count a function calling itself", () => {
		const src = "function loop(n: number): number {\n  return n > 0 ? loop(n - 1) : 0;\n}\n";
		expect(refsIn(src, "loop")).toBe(0);
	});

	it("treats a class type parameter as shadowing a module-level type", () => {
		const src = [
			"type Item = string;",
			"export class Box<Item> {",
			"  get(x: Item): Item {",
			"    return x;",
			"  }",
			"}",
			"",
		].join("\n");
		expect(refsIn(src, "Item")).toBe(0);
	});

	it("does not count a re-export as a use in the re-exporting file", () => {
		const src = 'export { caller } from "./utils.js";\nexport function caller2(): void {}\n';
		expect(refsIn(src, "caller2")).toBe(0);
	});
});

describe("imports (REQ-UNIT-31)", () => {
	it("records named, renamed, namespace and re-exported names resolved to a file", () => {
		const rel = consumer.imports.map((i) => ({ ...i, from: path.relative(root, i.from) }));
		expect(rel).toEqual([
			{ from: "src/utils.ts", name: "shared", local: "shared" },
			{ from: "src/utils.ts", name: "Api", local: "A" },
			{ from: "src/utils.ts", name: "*", local: "U" },
			{ from: "src/utils.ts", name: "caller", local: "caller" },
		]);
	});

	it("records no import it cannot resolve to an existing file", () => {
		expect(consumer.imports.some((i) => i.name === "thing" || i.name === "gone")).toBe(false);
	});

	it("records member accesses through imported bindings", () => {
		expect([...consumer.memberRefs].sort()).toEqual(["A.unused", "U.privateDead"]);
	});
});

describe("export specifiers (REQ-UNIT-34)", () => {
	it("marks a declaration exported through `export { name }`", () => {
		expect(utils.units.find((u) => u.id === "helper2")?.exported).toBe(true);
		expect(utils.units.find((u) => u.id === "privateUsed")?.exported).toBe(false);
	});
});
