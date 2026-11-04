/**
 * Moves an existing session aside before `init` starts over
 * (LLD-first-run.md, REQ-RUN-32..34).
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, PathValidator } from "@dev-session/security";

/** The directory inside `.session/` that holds backups. */
export const SESSION_BACKUP_DIRNAME = "backups";

/** The file whose presence means there is progress to lose. */
const SESSION_STATE_FILENAME = "SESSION_STATE.md";

/** Ignores the whole backup directory, whatever the project's own `.gitignore` says. */
const BACKUP_GITIGNORE = "# Written by dev-sesssion init --fresh; backups are never committed\n*\n";

/** Where a start-over put the old session. */
export interface SessionBackupResult {
	/** The new backup directory, relative to `.session/`, with `/` separators. */
	readonly relativeDir: string;
	/** The names of the entries moved into it. */
	readonly moved: readonly string[];
}

/** Detects an existing session and moves it aside. */
export const SessionBackup = {
	/**
	 * Whether `.session/` holds a session with progress to lose.
	 *
	 * @param sessionDir - Validated path to `.session/`.
	 * @returns True when `SESSION_STATE.md` exists.
	 */
	exists(sessionDir: ValidatedPath): boolean {
		return fs.existsSync(path.join(sessionDir, SESSION_STATE_FILENAME));
	},

	/**
	 * The backup directory a start-over at `now` would use, relative to
	 * `.session/`. Pure apart from checking which names are taken.
	 *
	 * @param sessionDir - Validated path to `.session/`.
	 * @param now - The time to name the backup after.
	 * @returns A relative path such as `backups/2026-11-03T01-02-03Z`.
	 */
	plannedDir(sessionDir: ValidatedPath, now: Date): string {
		const stamp = `${now.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;
		let name = stamp;
		for (let n = 2; fs.existsSync(path.join(sessionDir, SESSION_BACKUP_DIRNAME, name)); n++) {
			name = `${stamp}-${String(n)}`;
		}
		return `${SESSION_BACKUP_DIRNAME}/${name}`;
	},

	/**
	 * Moves every entry in `.session/` except `backups/` into a new backup
	 * directory, and makes sure `backups/` ignores itself in git.
	 *
	 * @param sessionDir - Validated path to `.session/`.
	 * @param now - The time to name the backup after.
	 * @returns Where the entries went and which were moved.
	 * @throws {SecurityError} If an entry name would escape `.session/`.
	 */
	moveAside(sessionDir: ValidatedPath, now: Date): SessionBackupResult {
		const relativeDir = SessionBackup.plannedDir(sessionDir, now);
		const dest = PathValidator.safeResolvePath(relativeDir, sessionDir);
		fs.mkdirSync(dest, { recursive: true });
		writeBackupGitignore(sessionDir);

		const moved: string[] = [];
		for (const name of fs.readdirSync(sessionDir)) {
			if (name === SESSION_BACKUP_DIRNAME) continue;
			const from = PathValidator.safeResolvePath(name, sessionDir);
			fs.renameSync(from, path.join(dest, name));
			moved.push(name);
		}
		return { relativeDir, moved };
	},
};

/**
 * Writes `backups/.gitignore` if it is missing.
 *
 * @param sessionDir - Validated path to `.session/`.
 * @returns void
 */
function writeBackupGitignore(sessionDir: ValidatedPath): void {
	const target = PathValidator.safeResolvePath(`${SESSION_BACKUP_DIRNAME}/.gitignore`, sessionDir);
	if (!fs.existsSync(target)) AtomicWriter.writeFile(target, BACKUP_GITIGNORE);
}
