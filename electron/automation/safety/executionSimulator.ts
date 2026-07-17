import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { resolveFolderPath } from "../desktop/openFolder.js";
import { searchFileByNameAsync } from "../desktop/searchFiles.js";

export type SimulateResult = {
  summary: string;
  targets: string[];
};

export type SafetySlots = {
  sourceName?: string;
  newName?: string;
  destinationFolder?: string;
  parentFolder?: string;
  fileName?: string;
  folderName?: string;
  command?: string;
  scriptPath?: string;
  operation?: string;
  app?: string;
};

async function resolveFilePath(
  sourceName: string,
  parent?: string,
): Promise<string | null> {
  if (parent) {
    const folder = resolveFolderPath(parent);
    const direct = join(folder, sourceName);
    if (existsSync(direct)) return direct;
  }
  return searchFileByNameAsync(sourceName);
}

function normalizeDir(path: string): string {
  return resolveFolderPath(path).replace(/\\/g, "/").toLowerCase();
}

function resolvedFileName(raw: string): string {
  let filename = raw.trim();
  if (!/\.[a-z0-9]{2,8}$/i.test(filename)) {
    filename = `${filename}.txt`;
  }
  return filename;
}

export async function simulateDeleteFile(
  sourceName: string,
  parent?: string,
): Promise<SimulateResult> {
  const path = await resolveFilePath(sourceName, parent);
  if (!path) {
    return {
      summary: `Would delete: (not found) "${sourceName}"`,
      targets: [],
    };
  }
  return {
    summary: `Would delete:\n- ${path}`,
    targets: [path],
  };
}

export async function simulateMoveFile(
  sourceName: string,
  destination: string,
  parent?: string,
): Promise<SimulateResult> {
  const from = await resolveFilePath(sourceName, parent);
  const destFolder = resolveFolderPath(destination);
  const to = from
    ? join(destFolder, basename(from))
    : join(destFolder, sourceName.split(/[/\\]/).pop() ?? sourceName);
  if (!from) {
    return {
      summary: `Would move: (source not found) "${sourceName}" → ${destFolder}`,
      targets: [],
    };
  }
  const overwrite = existsSync(to);
  return {
    summary: `Would move:\n- ${from}\n→ ${to}${overwrite ? "\n\n⚠ Destination already exists." : ""}`,
    targets: [from, to],
  };
}

export async function simulateRenameFile(
  sourceName: string,
  newName: string,
  parent?: string,
): Promise<SimulateResult> {
  const from = await resolveFilePath(sourceName, parent);
  if (!from) {
    return {
      summary: `Would rename: (not found) "${sourceName}" → "${newName}"`,
      targets: [],
    };
  }
  const dir = dirname(from);
  const to = join(dir, basename(newName.trim()));
  const overwrite = existsSync(to);
  return {
    summary: `Would rename:\n- ${from}\n→ ${to}${overwrite ? "\n\n⚠ Target name already exists." : ""}`,
    targets: [from, to],
  };
}

export async function simulateCreateFile(
  fileName: string,
  parent?: string,
): Promise<SimulateResult> {
  if (!parent?.trim()) {
    return {
      summary: `Would create file "${fileName}" (parent folder missing)`,
      targets: [],
    };
  }
  const parentPath = resolveFolderPath(parent);
  const filename = resolvedFileName(fileName);
  const filePath = join(parentPath, filename);
  const exists = existsSync(filePath);
  return {
    summary: exists
      ? `Would overwrite existing file:\n- ${filePath}`
      : `Would create file:\n- ${filePath}`,
    targets: [filePath],
  };
}

/** Move across different parent folders needs confirm (P4.5). */
export async function moveNeedsConfirm(
  sourceName: string,
  destination: string,
  parent?: string,
): Promise<boolean> {
  const from = await resolveFilePath(sourceName, parent);
  if (!from) return true;
  const sourceParent = normalizeDir(dirname(from));
  const destParent = normalizeDir(resolveFolderPath(destination));
  return sourceParent !== destParent;
}

/** Rename when target name already exists needs confirm. */
export async function renameNeedsConfirm(
  sourceName: string,
  newName: string,
  parent?: string,
): Promise<boolean> {
  const from = await resolveFilePath(sourceName, parent);
  if (!from) return true;
  const to = join(dirname(from), basename(newName.trim()));
  return existsSync(to);
}

/** Create when file already exists needs confirm. */
export async function createFileNeedsConfirm(
  fileName: string,
  parent?: string,
): Promise<boolean> {
  if (!parent?.trim()) return false;
  const parentPath = resolveFolderPath(parent);
  const filePath = join(parentPath, resolvedFileName(fileName));
  return existsSync(filePath);
}

export async function simulateWriteFile(
  pathOrName: string,
  parent?: string,
): Promise<SimulateResult> {
  const path = parent
    ? join(resolveFolderPath(parent), pathOrName)
    : pathOrName;
  const exists = existsSync(path);
  return {
    summary: exists
      ? `Would overwrite file:\n- ${path}`
      : `Would write new file:\n- ${path}`,
    targets: [path],
  };
}

export async function simulatePatchFile(
  pathOrName: string,
  parent?: string,
): Promise<SimulateResult> {
  const path = parent
    ? join(resolveFolderPath(parent), pathOrName)
    : pathOrName;
  const exists = existsSync(path);
  return {
    summary: exists
      ? `Would patch file:\n- ${path}`
      : `Would patch (file not found):\n- ${path}`,
    targets: exists ? [path] : [],
  };
}

export async function simulateForKind(
  kind: string,
  slots: SafetySlots,
): Promise<SimulateResult> {
  switch (kind) {
    case "delete_file":
      return simulateDeleteFile(slots.sourceName ?? "", slots.parentFolder);
    case "move_file":
      return simulateMoveFile(
        slots.sourceName ?? "",
        slots.destinationFolder ?? "",
        slots.parentFolder,
      );
    case "rename_file":
      return simulateRenameFile(
        slots.sourceName ?? "",
        slots.newName ?? "",
        slots.parentFolder,
      );
    case "create_file":
      return simulateCreateFile(slots.fileName ?? "", slots.parentFolder);
    case "write_file":
      return simulateWriteFile(slots.sourceName ?? slots.fileName ?? "", slots.parentFolder);
    case "patch_file":
      return simulatePatchFile(slots.sourceName ?? slots.fileName ?? "", slots.parentFolder);
    case "run_command":
      return {
        summary: `Would run command:\n${slots.command ?? "(empty)"}`,
        targets: [],
      };
    case "run_script":
      return {
        summary: `Would run script:\n${slots.scriptPath ?? "(missing)"}`,
        targets: slots.scriptPath ? [slots.scriptPath] : [],
      };
    case "git_operation":
      return {
        summary: `Would run git ${slots.operation ?? "operation"}`,
        targets: [],
      };
    case "run_tests":
      return {
        summary: "Would run project test suite",
        targets: [],
      };
    case "copy_file":
      return {
        summary: `Would copy:\n${slots.sourceName ?? "(source)"} → ${slots.destinationFolder ?? "(dest)"}`,
        targets: [slots.sourceName, slots.destinationFolder].filter(
          (x): x is string => Boolean(x?.trim()),
        ),
      };
    case "run_as_admin":
      return {
        summary: `Would launch elevated:\n${slots.app ?? slots.command ?? "(app)"}`,
        targets: slots.app ? [slots.app] : [],
      };
    default:
      return { summary: `No simulation for ${kind}`, targets: [] };
  }
}

export async function needsSafetyConfirm(
  kind: string,
  slots: SafetySlots,
): Promise<boolean> {
  switch (kind) {
    case "delete_file":
      return true;
    case "move_file":
      return moveNeedsConfirm(
        slots.sourceName ?? "",
        slots.destinationFolder ?? "",
        slots.parentFolder,
      );
    case "rename_file":
      return renameNeedsConfirm(
        slots.sourceName ?? "",
        slots.newName ?? "",
        slots.parentFolder,
      );
    case "create_file":
      return createFileNeedsConfirm(slots.fileName ?? "", slots.parentFolder);
    case "write_file":
    case "patch_file":
      return true;
    case "copy_file":
    case "run_command":
    case "run_script":
    case "git_operation":
    case "run_tests":
    case "run_as_admin":
      return true;
    default:
      return false;
  }
}
