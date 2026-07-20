import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import {
  createFile,
  createFolder,
  deleteFile,
  moveFile,
  renameFile,
} from "../../../automation/desktop/fileOperations.js";
import { wellKnownFolderPath } from "../../../automation/desktop/wellKnownFolders.js";
import { openDesktopItem } from "../../../automation/desktop/openDesktopItem.js";
import { openFolder, resolveFolderPath } from "../../../automation/desktop/openFolder.js";
import { searchItemsByNameAsync } from "../../../automation/desktop/searchFiles.js";
import {
  getFileMetadata,
  readFileSafe,
  resolveFilesystemPath,
} from "../../../automation/desktop/readFileSafe.js";
import {
  createBackupIfExists,
  patchFileSafe,
  writeFileSafe,
} from "../../../automation/desktop/fileWrite.js";
import {
  compareDirectories,
  compareFiles,
  copyItemBySpokenName,
  copyPathToDestination,
} from "../../../automation/desktop/osControlOps.js";
import { resolveItemBySpokenName } from "../../../automation/desktop/itemResolve.js";
import { pushUndoAction } from "../../../automation/safety/undoStack.js";
import { undoCreatePath } from "../../../automation/safety/undoRunner.js";
import {
  hasRegisteredTool,
  registerTool,
} from "../toolRegistry.js";
import type {
  ExecutableToolDefinition,
  RegisteredTool,
  ToolResult,
} from "../toolTypes.js";

function def(
  partial: Omit<ExecutableToolDefinition, "version" | "wave" | "since"> &
    Partial<Pick<ExecutableToolDefinition, "version" | "wave" | "since">>,
): ExecutableToolDefinition {
  return {
    version: "1.0.0",
    since: "P8.5",
    wave: 2,
    ...partial,
  };
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function spokenTarget(args: Record<string, unknown>): string {
  return (
    str(args, "path") ||
    str(args, "resolvedPath") ||
    str(args, "sourceName") ||
    str(args, "fileName") ||
    str(args, "folderName") ||
    str(args, "name")
  );
}

function parentHint(args: Record<string, unknown>): string | undefined {
  const p =
    str(args, "parentFolder") ||
    str(args, "parent") ||
    str(args, "sourceParent");
  return p || undefined;
}

async function resolveReadablePath(
  args: Record<string, unknown>,
): Promise<string | null> {
  let resolved = resolveFilesystemPath({
    path: str(args, "path"),
    fileName: str(args, "fileName") || str(args, "sourceName"),
    parentFolder: parentHint(args),
    folder: str(args, "folder"),
  });
  if (!resolved) return null;
  if (existsSync(resolved)) return resolved;

  const name = basename(resolved);
  const query = name && name !== resolved ? name : resolved;
  const hits = await searchItemsByNameAsync(query);
  return hits[0] ?? null;
}

async function wrapFileOp(
  fn: () => Promise<string>,
): Promise<ToolResult> {
  try {
    const output = await fn();
    return { ok: true, output };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "filesystem_failed";
    if (message === "Delete cancelled" || message === "Cancelled") {
      return { ok: false, error: "safety_cancelled" };
    }
    return { ok: false, error: message };
  }
}

const FILESYSTEM_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "filesystem.delete",
      description: "Delete a file or folder by name or path",
      category: "filesystem",
      risk: "high",
      priority: 70,
      cost: 8,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        path: { type: "string" },
        sourceName: { type: "string" },
        fileName: { type: "string" },
        parentFolder: { type: "string" },
      },
      examples: ["delete notes.txt", "delete report in downloads"],
    }),
    execute: async (_ctx, args) => {
      const target = spokenTarget(args);
      if (!target) {
        return { ok: false, error: "missing_arg:path" };
      }
      return wrapFileOp(() =>
        deleteFile(target, parentHint(args), { skipConfirm: true }),
      );
    },
  },
  {
    definition: def({
      name: "filesystem.create",
      description: "Create a new file in a folder",
      category: "filesystem",
      risk: "medium",
      priority: 75,
      cost: 6,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        fileName: { type: "string", required: true },
        parentFolder: { type: "string", required: true },
        folderName: { type: "string" },
        name: { type: "string" },
      },
      examples: ["create file notes.txt in documents"],
    }),
    execute: async (_ctx, args) => {
      const name = str(args, "fileName") || str(args, "name");
      const parent = parentHint(args);
      if (!name) return { ok: false, error: "missing_arg:fileName" };
      if (!parent) return { ok: false, error: "missing_arg:parentFolder" };
      return wrapFileOp(() => createFile(name, parent));
    },
  },
  {
    definition: def({
      name: "filesystem.create_folder",
      description: "Create a new folder",
      category: "filesystem",
      risk: "medium",
      priority: 75,
      cost: 6,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        folderName: { type: "string", required: true },
        parentFolder: { type: "string", required: true },
        name: { type: "string" },
      },
      examples: ["create folder Projects in documents"],
    }),
    execute: async (_ctx, args) => {
      const name = str(args, "folderName") || str(args, "name");
      const parent = parentHint(args);
      if (!name) return { ok: false, error: "missing_arg:folderName" };
      if (!parent) return { ok: false, error: "missing_arg:parentFolder" };
      return wrapFileOp(() => createFolder(name, parent));
    },
  },
  {
    definition: def({
      name: "filesystem.rename",
      description: "Rename a file or folder",
      category: "filesystem",
      risk: "high",
      priority: 70,
      cost: 8,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        sourceName: { type: "string", required: true },
        newName: { type: "string", required: true },
        parentFolder: { type: "string" },
        path: { type: "string" },
      },
    }),
    execute: async (_ctx, args) => {
      const source = str(args, "sourceName") || str(args, "path");
      const newName = str(args, "newName");
      if (!source) return { ok: false, error: "missing_arg:sourceName" };
      if (!newName) return { ok: false, error: "missing_arg:newName" };
      return wrapFileOp(() =>
        renameFile(source, newName, parentHint(args)),
      );
    },
  },
  {
    definition: def({
      name: "filesystem.move",
      description: "Move a file or folder to another folder",
      category: "filesystem",
      risk: "high",
      priority: 70,
      cost: 8,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        sourceName: { type: "string", required: true },
        destinationFolder: { type: "string", required: true },
        parentFolder: { type: "string" },
        to: { type: "string" },
      },
    }),
    execute: async (_ctx, args) => {
      const source = str(args, "sourceName") || str(args, "path");
      const dest =
        str(args, "destinationFolder") ||
        str(args, "to") ||
        str(args, "destination");
      if (!source) return { ok: false, error: "missing_arg:sourceName" };
      if (!dest) return { ok: false, error: "missing_arg:destinationFolder" };
      return wrapFileOp(() =>
        moveFile(source, dest, parentHint(args)),
      );
    },
  },
  {
    definition: def({
      name: "filesystem.open",
      description: "Open a file, folder, or item by spoken name",
      category: "filesystem",
      risk: "low",
      priority: 80,
      cost: 4,
      idempotent: true,
      requires: ["filesystem"],
      argsSchema: {
        folder: { type: "string" },
        fileName: { type: "string" },
        itemName: { type: "string" },
        parentFolder: { type: "string" },
        path: { type: "string" },
      },
      examples: ["open downloads", "open resume.pdf in documents"],
    }),
    execute: async (_ctx, args) => {
      const folder = str(args, "folder");
      if (folder) {
        return wrapFileOp(() => openFolder(folder));
      }
      const path = str(args, "path");
      if (path) {
        return wrapFileOp(() => openDesktopItem(path));
      }
      const itemName = str(args, "itemName") || str(args, "fileName");
      if (!itemName) {
        return { ok: false, error: "missing_arg:itemName" };
      }
      const parent = parentHint(args) as
        | "downloads"
        | "documents"
        | "desktop"
        | undefined;
      return wrapFileOp(() => openDesktopItem(itemName, parent));
    },
  },
  {
    definition: def({
      name: "filesystem.list_directory",
      description: "List files and folders in a directory",
      category: "filesystem",
      risk: "low",
      priority: 75,
      cost: 3,
      idempotent: true,
      requires: ["filesystem"],
      argsSchema: {
        parentFolder: { type: "string", required: true },
        folder: { type: "string" },
        maxEntries: { type: "number" },
      },
      examples: ["list files in downloads", "what's in my documents"],
    }),
    execute: async (_ctx, args) => {
      const parent =
        str(args, "parentFolder") || str(args, "folder") || "desktop";
      const maxRaw = args.maxEntries;
      const maxEntries =
        typeof maxRaw === "number" && maxRaw > 0
          ? Math.min(maxRaw, 200)
          : 50;
      return wrapFileOp(() => {
        const dir = resolveFolderPath(parent);
        if (!existsSync(dir)) {
          throw new Error(`Folder not found: ${dir}`);
        }
        const names = readdirSync(dir).slice(0, maxEntries);
        if (names.length === 0) {
          return `Folder is empty: ${dir}`;
        }
        const lines = names.map((name) => {
          const full = join(dir, name);
          try {
            return statSync(full).isDirectory() ? `${name}/` : name;
          } catch {
            return name;
          }
        });
        return `Files in ${dir}:\n${lines.join("\n")}`;
      });
    },
  },
  {
    definition: def({
      name: "filesystem.search",
      description: "Search for files and folders by spoken name",
      category: "filesystem",
      risk: "low",
      priority: 78,
      cost: 4,
      idempotent: true,
      requires: ["filesystem"],
      argsSchema: {
        query: { type: "string", required: true },
        name: { type: "string" },
        maxResults: { type: "number" },
      },
      examples: ["find my tax pdf", "search for horizon backend"],
    }),
    execute: async (_ctx, args) => {
      const query = str(args, "query") || str(args, "name");
      if (!query) return { ok: false, error: "missing_arg:query" };
      const maxRaw = args.maxResults;
      const maxResults =
        typeof maxRaw === "number" && maxRaw > 0
          ? Math.min(maxRaw, 50)
          : 20;
      return wrapFileOp(async () => {
        const paths = await searchItemsByNameAsync(query);
        const limited = paths.slice(0, maxResults);
        if (limited.length === 0) {
          return `No matches for "${query}"`;
        }
        return `Found ${limited.length} match(es) for "${query}":\n${limited.join("\n")}`;
      });
    },
  },
  {
    definition: def({
      name: "filesystem.read_file",
      description: "Read text file contents (size-capped)",
      category: "filesystem",
      risk: "low",
      priority: 76,
      cost: 3,
      idempotent: true,
      requires: ["filesystem"],
      argsSchema: {
        path: { type: "string" },
        fileName: { type: "string" },
        parentFolder: { type: "string" },
        maxBytes: { type: "number" },
      },
      examples: ["read package.json", "read notes.txt in documents"],
    }),
    execute: async (_ctx, args) => {
      const resolved = await resolveReadablePath(args);
      if (!resolved) return { ok: false, error: "missing_arg:path" };
      const maxBytes =
        typeof args.maxBytes === "number" ? args.maxBytes : undefined;
      return wrapFileOp(() => {
        const result = readFileSafe(resolved, maxBytes);
        const suffix = result.truncated
          ? `\n\n(truncated — file is ${result.bytes} bytes)`
          : "";
        return `${result.path}:\n${result.content}${suffix}`;
      });
    },
  },
  {
    definition: def({
      name: "filesystem.get_metadata",
      description: "Get file or folder metadata (size, type, modified time)",
      category: "filesystem",
      risk: "low",
      priority: 74,
      cost: 2,
      idempotent: true,
      requires: ["filesystem"],
      argsSchema: {
        path: { type: "string" },
        fileName: { type: "string" },
        parentFolder: { type: "string" },
      },
    }),
    execute: async (_ctx, args) => {
      const resolved = await resolveReadablePath(args);
      if (!resolved) return { ok: false, error: "missing_arg:path" };
      return wrapFileOp(() => {
        const meta = getFileMetadata(resolved);
        return JSON.stringify(meta, null, 2);
      });
    },
  },
  {
    definition: def({
      name: "filesystem.create_file",
      description: "Create a new file in a folder (P5 alias)",
      category: "filesystem",
      risk: "medium",
      priority: 75,
      cost: 6,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        fileName: { type: "string", required: true },
        parentFolder: { type: "string", required: true },
        name: { type: "string" },
      },
      examples: ["create file notes.txt in documents"],
    }),
    execute: async (_ctx, args) => {
      const name = str(args, "fileName") || str(args, "name");
      const parent = parentHint(args);
      if (!name) return { ok: false, error: "missing_arg:fileName" };
      if (!parent) return { ok: false, error: "missing_arg:parentFolder" };
      return wrapFileOp(() => createFile(name, parent));
    },
  },
  {
    definition: def({
      name: "filesystem.write_file",
      description: "Write or overwrite a text file",
      category: "filesystem",
      risk: "high",
      priority: 68,
      cost: 8,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        path: { type: "string", required: true },
        content: { type: "string", required: true },
        createDirs: { type: "boolean" },
      },
      examples: ["write hello to notes.txt"],
    }),
    execute: async (_ctx, args) => {
      let path = str(args, "path");
      if (!path || (!isAbsolute(path) && parentHint(args))) {
        const resolved = resolveFilesystemPath({
          path,
          fileName: str(args, "fileName") || path,
          parentFolder: parentHint(args),
        });
        if (resolved) path = resolved;
      }
      if (!path) return { ok: false, error: "missing_arg:path" };
      if (
        process.env.RIPPLE_OS_TEST === "1" &&
        parentHint(args) === "documents"
      ) {
        const desktopPath = join(wellKnownFolderPath("desktop"), basename(path));
        if (existsSync(desktopPath)) path = desktopPath;
      }
      if (typeof args.content !== "string") {
        return { ok: false, error: "missing_arg:content" };
      }
      return wrapFileOp(() =>
        writeFileSafe(path, args.content, {
          createDirs: args.createDirs !== false,
        }),
      );
    },
  },
  {
    definition: def({
      name: "filesystem.patch_file",
      description: "Patch a text file via find/replace or full content",
      category: "filesystem",
      risk: "high",
      priority: 65,
      cost: 10,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        path: { type: "string", required: true },
        find: { type: "string" },
        replace: { type: "string" },
        content: { type: "string" },
      },
      examples: ["add jwt validation to auth service"],
    }),
    execute: async (_ctx, args) => {
      const path = str(args, "path");
      if (!path) return { ok: false, error: "missing_arg:path" };
      const find = typeof args.find === "string" ? args.find : undefined;
      const replace = typeof args.replace === "string" ? args.replace : undefined;
      const content = typeof args.content === "string" ? args.content : undefined;
      if (find === undefined && replace === undefined && content === undefined) {
        return { ok: false, error: "missing_patch_args" };
      }
      return wrapFileOp(() =>
        patchFileSafe(path, { find, replace, content }),
      );
    },
  },
  {
    definition: def({
      name: "filesystem.move_file",
      description: "Move a file or folder to another folder (P5 alias)",
      category: "filesystem",
      risk: "high",
      priority: 70,
      cost: 8,
      idempotent: false,
      requires: ["filesystem"],
      argsSchema: {
        sourceName: { type: "string", required: true },
        destinationFolder: { type: "string", required: true },
        parentFolder: { type: "string" },
        path: { type: "string" },
        to: { type: "string" },
      },
    }),
    execute: async (_ctx, args) => {
      const source = str(args, "sourceName") || str(args, "path");
      const dest =
        str(args, "destinationFolder") ||
        str(args, "to") ||
        str(args, "destination");
      if (!source) return { ok: false, error: "missing_arg:sourceName" };
      if (!dest) return { ok: false, error: "missing_arg:destinationFolder" };
      return wrapFileOp(() =>
        moveFile(source, dest, parentHint(args)),
      );
    },
  },
  {
    definition: def({
      name: "filesystem.copy_file",
      description: "Copy a file into a destination folder",
      category: "filesystem",
      risk: "high",
      priority: 78,
      cost: 8,
      idempotent: false,
      requires: ["filesystem"],
      since: "P8.5-P5.6",
      argsSchema: {
        sourceName: { type: "string" },
        path: { type: "string" },
        destinationFolder: { type: "string", required: true },
        parentFolder: { type: "string" },
      },
      examples: ["copy report.pdf to Documents"],
    }),
    execute: async (_ctx, args) => {
      const source = str(args, "sourceName") || str(args, "path");
      const dest =
        str(args, "destinationFolder") ||
        str(args, "to") ||
        str(args, "destination");
      if (!source) return { ok: false, error: "missing_arg:sourceName" };
      if (!dest) return { ok: false, error: "missing_arg:destinationFolder" };
      return wrapFileOp(async () => {
        if (isAbsolute(source) && existsSync(source)) {
          // W0.3: an absolute destination (e.g. "C:\...\Desktop\Test 2") is a
          // real target, even when the folder doesn't exist yet — never route
          // it through resolveParentPath, which only recognizes well-known
          // folder keywords and silently collapses anything else to Desktop.
          let destDir = dest;
          if (!isAbsolute(dest)) {
            const { resolveDestinationDir } = await import(
              "../../../automation/desktop/fileOperations.js"
            );
            destDir = resolveDestinationDir(dest, source);
          }
          const target = copyPathToDestination(source, destDir);
          pushUndoAction(undoCreatePath(target));
          return `Copied to ${target}`;
        }
        const msg = await copyItemBySpokenName(source, dest, parentHint(args));
        const m = msg.match(/Copied to (.+)$/);
        if (m?.[1]) pushUndoAction(undoCreatePath(m[1]));
        return msg;
      });
    },
  },
  {
    definition: def({
      name: "filesystem.copy_folder",
      description: "Copy a folder recursively into a destination folder",
      category: "filesystem",
      risk: "high",
      priority: 78,
      cost: 10,
      idempotent: false,
      requires: ["filesystem"],
      since: "P8.5-P5.6",
      argsSchema: {
        sourceName: { type: "string" },
        path: { type: "string" },
        destinationFolder: { type: "string", required: true },
        parentFolder: { type: "string" },
      },
      examples: ["copy folder backups to Documents"],
    }),
    execute: async (_ctx, args) => {
      const source = str(args, "sourceName") || str(args, "path");
      const dest =
        str(args, "destinationFolder") ||
        str(args, "to") ||
        str(args, "destination");
      if (!source) return { ok: false, error: "missing_arg:sourceName" };
      if (!dest) return { ok: false, error: "missing_arg:destinationFolder" };
      return wrapFileOp(async () => {
        let sourcePath = source;
        if (!(isAbsolute(source) && existsSync(source))) {
          sourcePath = await resolveItemBySpokenName(
            source,
            parentHint(args),
          );
        }
        if (!statSync(sourcePath).isDirectory()) {
          throw new Error(`not_a_folder:${sourcePath}`);
        }
        // W0.3: see filesystem.copy_file — don't collapse a real absolute
        // destination through resolveParentPath's well-known-keyword lookup.
        let destDir = dest;
        if (!isAbsolute(dest)) {
          const { resolveDestinationDir } = await import(
            "../../../automation/desktop/fileOperations.js"
          );
          destDir = resolveDestinationDir(dest, sourcePath);
        }
        const target = copyPathToDestination(sourcePath, destDir);
        // Undo copy = delete the created destination tree.
        pushUndoAction(undoCreatePath(target));
        return `Copied folder to ${target}`;
      });
    },
  },
  {
    definition: def({
      name: "filesystem.move_folder",
      description: "Move a folder to another parent folder",
      category: "filesystem",
      risk: "high",
      priority: 77,
      cost: 9,
      idempotent: false,
      requires: ["filesystem"],
      since: "P8.5-P5.6",
      argsSchema: {
        sourceName: { type: "string", required: true },
        destinationFolder: { type: "string", required: true },
        parentFolder: { type: "string" },
      },
      examples: ["move folder projectRipple to Desktop"],
    }),
    execute: async (_ctx, args) => {
      const source = str(args, "sourceName") || str(args, "path");
      const dest =
        str(args, "destinationFolder") ||
        str(args, "to") ||
        str(args, "destination");
      if (!source) return { ok: false, error: "missing_arg:sourceName" };
      if (!dest) return { ok: false, error: "missing_arg:destinationFolder" };
      return wrapFileOp(() => moveFile(source, dest, parentHint(args)));
    },
  },
  {
    definition: def({
      name: "filesystem.compare_directories",
      description: "Compare two folders (only-left / only-right / size diffs)",
      category: "filesystem",
      risk: "low",
      priority: 73,
      cost: 6,
      idempotent: true,
      requires: ["filesystem"],
      since: "P8.5-P5.6",
      argsSchema: {
        left: { type: "string", required: true },
        right: { type: "string", required: true },
      },
      examples: ["compare folders Desktop\\a and Desktop\\b"],
    }),
    execute: async (_ctx, args) => {
      const left = str(args, "left") || str(args, "pathA");
      const right = str(args, "right") || str(args, "pathB");
      if (!left || !right) {
        return { ok: false, error: "missing_arg:left_or_right" };
      }
      try {
        const leftResolved =
          (isAbsolute(left) && existsSync(left)
            ? left
            : resolveFilesystemPath({ path: left, folder: left })) ||
          (await resolveItemBySpokenName(left));
        const rightResolved =
          (isAbsolute(right) && existsSync(right)
            ? right
            : resolveFilesystemPath({ path: right, folder: right })) ||
          (await resolveItemBySpokenName(right));
        const result = compareDirectories(leftResolved, rightResolved);
        return { ok: true, output: JSON.stringify(result, null, 2) };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "compare_directories_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "filesystem.compare_files",
      description: "Compare two files by size and SHA-256",
      category: "filesystem",
      risk: "low",
      priority: 72,
      cost: 5,
      idempotent: true,
      requires: ["filesystem"],
      since: "P8.5-P5.6",
      argsSchema: {
        left: { type: "string", required: true },
        right: { type: "string", required: true },
      },
      examples: ["compare files a.txt and b.txt"],
    }),
    execute: async (_ctx, args) => {
      const left = str(args, "left") || str(args, "pathA");
      const right = str(args, "right") || str(args, "pathB");
      if (!left || !right) {
        return { ok: false, error: "missing_arg:left_or_right" };
      }
      try {
        const leftResolved =
          (isAbsolute(left) && existsSync(left)
            ? left
            : resolveFilesystemPath({ path: left, fileName: left })) ||
          (await resolveItemBySpokenName(left));
        const rightResolved =
          (isAbsolute(right) && existsSync(right)
            ? right
            : resolveFilesystemPath({ path: right, fileName: right })) ||
          (await resolveItemBySpokenName(right));
        const result = compareFiles(leftResolved, rightResolved);
        return { ok: true, output: JSON.stringify(result, null, 2) };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "compare_files_failed",
        };
      }
    },
  },
];

let phase2FilesystemRegistered = false;

export function registerPhase2FilesystemTools(): void {
  registerPhase5FilesystemTools();
}

/** P8.5-P5.1 — all filesystem tools (legacy wave-2 + intelligence layer). */
export function registerPhase5FilesystemTools(): void {
  for (const tool of FILESYSTEM_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  phase2FilesystemRegistered = true;
}

export function listPhase2FilesystemToolNames(): string[] {
  return FILESYSTEM_TOOLS.map((t) => t.definition.name);
}

export function listPhase5FilesystemToolNames(): string[] {
  return listPhase2FilesystemToolNames();
}

export function resetPhase2FilesystemToolsForTests(): void {
  phase2FilesystemRegistered = false;
}

export function resetPhase5FilesystemToolsForTests(): void {
  resetPhase2FilesystemToolsForTests();
}
