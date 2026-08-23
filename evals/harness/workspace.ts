/**
 * Builds isolated, git-backed workspaces for a single eval run.
 *
 * Each workspace is a copy of the target with `.session/` stripped and the
 * ablated files deleted, so `init` regenerates context from scratch against a
 * repo where the work genuinely is not done.
 *
 * @module
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { Ablation } from "../types.js";

const execFileAsync = promisify(execFile);

/** Committer identity for throwaway repos — replay scoring needs real history. */
const GIT_IDENTITY = [
	"-c",
	"user.email=eval@dev-sesssion.invalid",
	"-c",
	"user.name=dev-sesssion eval",
];

/** Directories never copied into a workspace. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

/** A prepared workspace. */
export interface Workspace {
	readonly dir: string;
	/** Contents of files removed by the ablation, keyed by repo-relative path. */
	readonly groundTruth: ReadonlyMap<string, string>;
	/** Runs git in the workspace. */
	git(args: readonly string[]): Promise<string>;
	cleanup(): Promise<void>;
}

/**
 * Recursively copies a directory, skipping build and VCS output.
 *
 * @param src - Source directory.
 * @param dest - Destination directory.
 */
async function copyTree(src: string, dest: string): Promise<void> {
	await fs.mkdir(dest, { recursive: true });
	for (const entry of await fs.readdir(src, { withFileTypes: true })) {
		if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
		const from = path.join(src, entry.name);
		const to = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			await copyTree(from, to);
		} else if (entry.isFile()) {
			await fs.copyFile(from, to);
		}
	}
}

/**
 * Prepares a workspace: copy target, strip `.session/`, apply the ablation, commit.
 *
 * @param sourceDir - Absolute path to the target directory.
 * @param ablation - Ablation to apply, or null for an unmodified baseline.
 * @returns The prepared workspace.
 * @throws {Error} If an ablated file does not exist in the source.
 */
export async function prepareWorkspace(
	sourceDir: string,
	ablation: Ablation | null,
): Promise<Workspace> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-sesssion-eval-ws-"));
	await copyTree(sourceDir, dir);

	// The committed .session/ is a static expectation; the eval regenerates it.
	await fs.rm(path.join(dir, ".session"), { recursive: true, force: true });

	const groundTruth = new Map<string, string>();
	for (const rel of ablation?.removeFiles ?? []) {
		const abs = path.join(dir, rel);
		let content: string;
		try {
			content = await fs.readFile(abs, "utf8");
		} catch {
			throw new Error(`ablation "${ablation?.id}" targets ${rel}, which is not in the target`);
		}
		groundTruth.set(rel, content);
		await fs.rm(abs);
	}

	const git = async (args: readonly string[]): Promise<string> => {
		const { stdout } = await execFileAsync("git", [...GIT_IDENTITY, ...args], {
			cwd: dir,
			maxBuffer: 32 * 1024 * 1024,
		});
		return stdout;
	};

	await git(["init", "--quiet", "--initial-branch=main"]);
	await git(["add", "-A"]);
	await git(["commit", "--quiet", "-m", "chore: eval baseline"]);

	return {
		dir,
		groundTruth,
		git,
		cleanup: () => fs.rm(dir, { recursive: true, force: true }),
	};
}

/**
 * Captures the contents of every file under a workspace subdirectory.
 *
 * @param workspaceDir - Absolute workspace root.
 * @param relDir - Repo-relative subdirectory to snapshot.
 * @returns Repo-relative path to contents; empty when the directory is absent.
 */
export async function snapshotTree(
	workspaceDir: string,
	relDir: string,
): Promise<Map<string, string>> {
	const snap = new Map<string, string>();
	const root = path.join(workspaceDir, relDir);
	const walk = async (dir: string): Promise<void> => {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) await walk(abs);
			else if (entry.isFile()) {
				const rel = path.relative(workspaceDir, abs).split(path.sep).join("/");
				snap.set(rel, await fs.readFile(abs, "utf8"));
			}
		}
	};
	try {
		await walk(root);
	} catch {
		// Absent directory snapshots as empty.
	}
	return snap;
}

/**
 * Restores a snapshotted subdirectory, undoing anything the agent changed.
 *
 * The objective gate must not be writable by the subject being graded: an agent
 * that edits the tests scoring it can pass them trivially. Tampering is itself a
 * signal, so the affected paths are returned rather than silently discarded.
 *
 * @param workspaceDir - Absolute workspace root.
 * @param relDir - Repo-relative subdirectory to restore.
 * @param snapshot - Snapshot taken before the agent ran.
 * @returns Repo-relative paths that were added, modified, or deleted.
 */
export async function restoreTree(
	workspaceDir: string,
	relDir: string,
	snapshot: ReadonlyMap<string, string>,
): Promise<string[]> {
	const after = await snapshotTree(workspaceDir, relDir);
	const tampered = new Set<string>();

	for (const [rel, content] of after) {
		if (!snapshot.has(rel)) {
			tampered.add(rel);
			await fs.rm(path.join(workspaceDir, rel), { force: true });
		} else if (snapshot.get(rel) !== content) {
			tampered.add(rel);
		}
	}
	for (const [rel, content] of snapshot) {
		if (after.get(rel) !== content) {
			tampered.add(rel);
			const abs = path.join(workspaceDir, rel);
			await fs.mkdir(path.dirname(abs), { recursive: true });
			await fs.writeFile(abs, content, "utf8");
		}
	}
	return [...tampered];
}
