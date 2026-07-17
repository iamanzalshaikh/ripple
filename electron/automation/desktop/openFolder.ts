import { existsSync } from "node:fs";
import { shell } from "electron";
import { recordFileTouch } from "../../storage/recordFileTouch.js";
import { wellKnownFolderPath, resolveWellKnownFolderKey } from "./wellKnownFolders.js";

export function resolveFolderPath(nameOrPath: string): string {
  const key = resolveWellKnownFolderKey(nameOrPath);
  if (key) return wellKnownFolderPath(key);
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
  recordFileTouch({ path: resolved, source: "open" });
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
  recordFileTouch({ path, source: "open" });
  return `Opened file: ${path}`;
}
