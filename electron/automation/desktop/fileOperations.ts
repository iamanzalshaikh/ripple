import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { dialog, shell } from "electron";
import { openFile, openFolder } from "./openFolder.js";
import { resolveItemBySpokenName } from "./itemResolve.js";

const WELL_KNOWN_PARENTS: Record<string, () => string> = {
  downloads: () => join(homedir(), "Downloads"),
  documents: () => join(homedir(), "Documents"),
  desktop: () => join(homedir(), "Desktop"),
};

export function resolveParentPath(name?: string): string {
  if (!name?.trim()) return join(homedir(), "Desktop");
  const key = name.trim().toLowerCase();
  if (WELL_KNOWN_PARENTS[key]) return WELL_KNOWN_PARENTS[key]();
  return name;
}

export async function createFolder(
  name: string,
  parent?: string,
): Promise<string> {
  const parentPath = resolveParentPath(parent);
  const folderPath = join(parentPath, name.trim());

  mkdirSync(folderPath, { recursive: true });
  const err = await shell.openPath(folderPath);
  if (err) throw new Error(err);

  console.info(`[ripple-desktop] Created folder → ${folderPath}`);
  return `Created folder: ${folderPath}`;
}

export async function createFile(
  name: string,
  parent?: string,
): Promise<string> {
  const parentPath = resolveParentPath(parent);
  mkdirSync(parentPath, { recursive: true });

  let filename = name.trim();
  if (!/\.[a-z0-9]{2,8}$/i.test(filename)) {
    filename = `${filename}.txt`;
  }

  const filePath = join(parentPath, filename);
  writeFileSync(filePath, "", { encoding: "utf8" });

  console.info(`[ripple-desktop] Created file → ${filePath}`);
  return openFile(filePath);
}

export async function openAliasTarget(
  type: "folder" | "file" | "project" | "workspace",
  path: string,
): Promise<string> {
  if (type === "workspace") {
    const { openUrlInBrowser } = await import("../openUrl.js");
    await openUrlInBrowser(path);
    return `Opened workspace: ${path}`;
  }

  if (type === "file") {
    return openFile(path);
  }

  return openFolder(path);
}

/** Resolve a spoken file/folder name to a full path. */
export async function resolveFileBySpokenName(
  spoken: string,
  parent?: string,
): Promise<string> {
  return resolveItemBySpokenName(spoken, parent);
}

export async function renameFile(
  sourceName: string,
  newName: string,
  parent?: string,
): Promise<string> {
  const sourcePath = await resolveItemBySpokenName(sourceName, parent);
  const dir = dirname(sourcePath);
  const targetName = newName.trim();
  if (!targetName) throw new Error("New filename required");

  const targetPath = join(dir, basename(targetName));
  if (existsSync(targetPath)) {
    throw new Error(`File already exists: ${targetPath}`);
  }

  renameSync(sourcePath, targetPath);
  console.info(`[ripple-desktop] Renamed → ${targetPath}`);
  return `Renamed to ${targetPath}`;
}

export async function moveFile(
  sourceName: string,
  destination: string,
  parent?: string,
): Promise<string> {
  const sourcePath = await resolveItemBySpokenName(sourceName, parent);
  const destDir = resolveParentPath(destination);
  mkdirSync(destDir, { recursive: true });

  const targetPath = join(destDir, basename(sourcePath));
  if (existsSync(targetPath)) {
    throw new Error(`File already exists: ${targetPath}`);
  }

  renameSync(sourcePath, targetPath);
  console.info(`[ripple-desktop] Moved → ${targetPath}`);
  return `Moved to ${targetPath}`;
}

async function confirmDelete(filePath: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Ripple — confirm delete",
    message: "Delete this file?",
    detail: filePath,
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
}

export async function deleteFile(
  sourceName: string,
  parent?: string,
): Promise<string> {
  const sourcePath = await resolveItemBySpokenName(sourceName, parent);

  const ok = await confirmDelete(sourcePath);
  if (!ok) {
    throw new Error("Delete cancelled");
  }

  unlinkSync(sourcePath);
  console.info(`[ripple-desktop] Deleted → ${sourcePath}`);
  return `Deleted ${basename(sourcePath)}`;
}
