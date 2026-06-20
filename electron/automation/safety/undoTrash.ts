import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getRippleDataDir } from "../../config/ripplePaths.js";

function undoTrashDir(): string {
  const dir = join(getRippleDataDir(), "undo-trash");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Move a file/folder aside before delete so P4.7 undo can restore it. */
export function stageDeleteBackup(originalPath: string): string {
  if (!existsSync(originalPath)) {
    throw new Error(`Cannot stage delete — missing ${originalPath}`);
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const backupPath = join(undoTrashDir(), `${stamp}-${basename(originalPath)}`);
  renameSync(originalPath, backupPath);
  return backupPath;
}

export function isDirectoryPath(path: string): boolean {
  return statSync(path).isDirectory();
}
