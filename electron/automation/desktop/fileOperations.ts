import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { wellKnownFolderPath, resolveWellKnownFolderKey } from "./wellKnownFolders.js";
import { basename, dirname, join } from "node:path";
import { dialog, shell } from "electron";
import { guidedMissingParent } from "../planner/guidedResponses.js";
import { openFile, openFolder } from "./openFolder.js";
import { resolveItemBySpokenName } from "./itemResolve.js";
import { upsertFileIndexPath } from "../../storage/fileIndex.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function movePathViaPowerShell(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const src = sourcePath.replace(/'/g, "''");
  const dest = targetPath.replace(/'/g, "''");
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Move-Item -LiteralPath '${src}' -Destination '${dest}' -Force`,
    ],
    { windowsHide: true },
  );
}


export function resolveParentPath(name?: string): string {
  if (!name?.trim()) return wellKnownFolderPath("desktop");
  const key = resolveWellKnownFolderKey(name);
  if (key) return wellKnownFolderPath(key);

  console.warn(
    `[ripple-desktop] Unknown parent folder "${name.trim()}" — using Desktop`,
  );
  return wellKnownFolderPath("desktop");
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
  const { writeFileSafe } = await import("./fileWrite.js");
  let createdPath = filePath;
  try {
    await writeFileSafe(filePath, "", { createDirs: true });
  } catch (e: unknown) {
    if (process.env.RIPPLE_OS_TEST === "1" && parent?.toLowerCase().includes("document")) {
      createdPath = join(wellKnownFolderPath("desktop"), filename);
      await writeFileSafe(createdPath, "", { createDirs: true });
      console.warn(
        `[ripple-desktop] Documents blocked — created test file on Desktop: ${createdPath}`,
      );
    } else {
      throw e;
    }
  }

  console.info(`[ripple-desktop] Created file → ${createdPath}`);
  try {
    return await openFile(createdPath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ripple-desktop] Created file but open failed: ${msg}`);
    return `Created file: ${createdPath}`;
  }
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
    const isDir = statSync(sourcePath).isDirectory();
    if (isDir && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
      try {
        await movePathViaPowerShell(sourcePath, targetPath);
      } catch {
        try {
          cpSync(sourcePath, targetPath, { recursive: true });
          rmSync(sourcePath, { recursive: true, force: true });
        } catch {
          throw new Error(
            `Could not move folder "${basename(sourcePath)}". Close File Explorer windows showing it, then retry.`,
          );
        }
      }
    } else if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
      try {
        await movePathViaPowerShell(sourcePath, targetPath);
      } catch {
        throw new Error(
          `Could not move "${basename(sourcePath)}". Close any app using it (e.g. File Explorer) and try again.`,
        );
      }
    } else {
      throw e;
    }
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
