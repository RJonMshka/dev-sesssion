/**
 * The script of a single-file component, at its original positions
 * (LLD-sfc-index.md, REQ-SFC-1..3).
 *
 * Every character outside a `<script>` body is replaced with a space; newlines
 * are kept. The result has the component's length and every script character at
 * its original line and column, so the existing extraction pipeline reports
 * positions in the component file with no offset table.
 *
 * @packageDocumentation
 */

/** File extensions treated as single-file components. */
export const SFC_EXTENSIONS: ReadonlySet<string> = new Set([".vue", ".svelte"]);

/** The parseable program of a component. */
export interface ScriptProgram {
	/** The component with everything but script bodies blanked. */
	readonly program: string;
	/** Whether any block declares `lang="tsx"` or `lang="jsx"` (REQ-SFC-3). */
	readonly jsx: boolean;
}

/** One `<script>` body's character range, end-exclusive. */
interface Range {
	readonly start: number;
	readonly end: number;
}

const OPEN_RE = /<script(?=[\s>])/gi;
const CLOSE = "</script";
const JSX_LANG_RE = /\blang\s*=\s*["']?(tsx|jsx)\b/i;

/**
 * Finds every `<script>` body. An unterminated block runs to end of file.
 *
 * @param source - The component source.
 * @returns Body ranges, and whether any opening tag asks for JSX.
 */
function scriptBodies(source: string): { ranges: Range[]; jsx: boolean } {
	const ranges: Range[] = [];
	let jsx = false;
	const lower = source.toLowerCase();
	OPEN_RE.lastIndex = 0;
	for (let m = OPEN_RE.exec(source); m !== null; m = OPEN_RE.exec(source)) {
		const tagEnd = source.indexOf(">", m.index);
		if (tagEnd === -1) break;
		if (JSX_LANG_RE.test(source.slice(m.index, tagEnd))) jsx = true;
		const close = lower.indexOf(CLOSE, tagEnd + 1);
		const end = close === -1 ? source.length : close;
		ranges.push({ start: tagEnd + 1, end });
		OPEN_RE.lastIndex = end;
	}
	return { ranges, jsx };
}

/**
 * Blanks everything in a component except its script bodies.
 *
 * @param source - The component source.
 * @returns The program to parse, and whether to enable JSX.
 */
export function scriptProgram(source: string): ScriptProgram {
	const { ranges, jsx } = scriptBodies(source);
	const out = source.replace(/[^\n]/g, " ").split("");
	for (const { start, end } of ranges) {
		for (let i = start; i < end; i++) out[i] = source[i] ?? " ";
	}
	return { program: out.join(""), jsx };
}
