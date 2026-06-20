import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { dialog, shell } from "electron";
import { guidedMissingParent } from "../planner/guidedResponses.js";
import { openFile, openFolder } from "./openFolder.js";
import { resolveItemBySpokenName } from "./itemResolve.js";
import { upsertFileIndexPath } from "../../storage/fileIndex.js";

const WELL_KNOWN_PARENTS: Record<string, () => string> = {
  downloads: () => join(homedir(), "Downloads"),
  documents: () => join(homedir(), "Documents"),
  desktop: () => join(homedir(), "Desktop"),
};

export function resolveParentPath(name?: string): string {
  if (!name?.trim()) return join(homedir(), "Desktop");
  const raw = name.trim();
  const key = raw.toLowerCase();
  if (WELL_KNOWN_PARENTS[key]) return WELL_KNOWN_PARENTS[key]();

  const embedded = key.match(/\b(?:in\s+)?(downloads?|documents?|desktop)\b/);
  if (embedded?.[1]) {
    const k = embedded[1];
    if (k.startsWith("download")) return WELL_KNOWN_PARENTS.downloads();
    if (k.startsWith("document")) return WELL_KNOWN_PARENTS.documents();
    return WELL_KNOWN_PARENTS.desktop();
  }

  if (key.startsWith("download")) return WELL_KNOWN_PARENTS.downloads();
  if (key.startsWith("document")) return WELL_KNOWN_PARENTS.documents();
  if (key === "desktop") return WELL_KNOWN_PARENTS.desktop();

  console.warn(
    `[ripple-desktop] Unknown parent folder "${raw}" — using Desktop`,
  );
  return join(homedir(), "Desktop");
}

export async function createFolder(
  name: string,
  parent?: string,
): Promise<string> {
  if (!parent?.trim()) {
    throw new Error(guidedMissingParent("folder"));
  }
  const parentPath = resolveParentPath(parent);
  const folderPath = join(parentPath, name.trim());

  mkdirSync(folderPath, { recursive: true });
  const err = await shell.openPath(folderPath);
  if (err) throw new Error(err);

  console.info(`[ripple-desktop] Created folder → ${folderPath}`);
  upsertFileIndexPath(folderPath);
  return `Created folder: ${folderPath}`;
}

export async function createFile(
  name: string,
  parent?: string,
): Promise<string> {
  if (!parent?.trim()) {
    throw new Error(guidedMissingParent("file"));
  }
  const parentPath = resolveParentPath(parent);
  mkdirSync(parentPath, { recursive: true });

  let filename = name.trim();
  if (!/\.[a-z0-9]{2,8}$/i.test(filename)) {
    filename = `${filename}.txt`;
  }

  const filePath = join(parentPath, filename);
  writeFileSync(filePath, "", { encoding: "utf8" });

  console.info(`[ripple-desktop] Created file → ${filePath}`);
  upsertFileIndexPath(filePath);
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
  upsertFileIndexPath(sourcePath);
  upsertFileIndexPath(targetPath);
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
    throw new Error(
      `Already exists at destination: ${targetPath}. Remove it first or use another name.`,
    );
  }

  try {
    renameSync(sourcePath, targetPath);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
      throw new Error(
        `Could not move "${basename(sourcePath)}". Close any app using it (e.g. File Explorer) and try again.`,
      );
    }
    throw e;
  }
  upsertFileIndexPath(sourcePath);
  upsertFileIndexPath(targetPath);
  console.info(`[ripple-desktop] Moved → ${targetPath}`);
  return `Moved to ${targetPath}`;
}

export async function confirmDeletePath(filePath: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Ripple — confirm delete",
    message: "Delete this item?",
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
  options?: { skipConfirm?: boolean },
): Promise<string> {
  const sourcePath = await resolveItemBySpokenName(sourceName, parent);

  if (!options?.skipConfirm) {
    const ok = await confirmDeletePath(sourcePath);
    if (!ok) {
      throw new Error("Delete cancelled");
    }
  }

  const stat = statSync(sourcePath);
  if (stat.isDirectory()) {
    try {
      rmSync(sourcePath, { recursive: true, force: true });
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        throw new Error(
          `Could not delete folder "${basename(sourcePath)}". Close File Explorer or apps using it, then try again.`,
        );
      }
      throw e;
    }
  } else {
    try {
      unlinkSync(sourcePath);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        throw new Error(
          `Could not delete "${basename(sourcePath)}". Close the file if it is open, then try again.`,
        );
      }
      throw e;
    }
  }
  upsertFileIndexPath(sourcePath);
  console.info(`[ripple-desktop] Deleted → ${sourcePath}`);
  return `Deleted ${basename(sourcePath)}`;
}
