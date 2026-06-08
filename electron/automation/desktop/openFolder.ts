import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { shell } from "electron";

const WELL_KNOWN: Record<string, () => string> = {
  downloads: () => join(homedir(), "Downloads"),
  documents: () => join(homedir(), "Documents"),
  desktop: () => join(homedir(), "Desktop"),
};

export function resolveFolderPath(nameOrPath: string): string {
  const key = nameOrPath.trim().toLowerCase();
  if (WELL_KNOWN[key]) return WELL_KNOWN[key]();
  return nameOrPath;
}

/** Open folder in Explorer/Finder (Electron shell — avoids explorer.exe exit-code false failures). */
export async function openFolder(path: string): Promise<string> {
  const resolved = resolveFolderPath(path);
  if (!existsSync(resolved)) {
    throw new Error(`Folder not found: ${resolved}`);
  }

  const err = await shell.openPath(resolved);
  if (err) {
    throw new Error(err);
  }
  return `Opened folder: ${resolved}`;
}

/** Open file with the OS default application. */
export async function openFile(path: string): Promise<string> {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }

  const err = await shell.openPath(path);
  if (err) {
    throw new Error(err);
  }
  return `Opened file: ${path}`;
}
