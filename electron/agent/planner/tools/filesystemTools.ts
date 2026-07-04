import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createFile,
  createFolder,
  deleteFile,
  moveFile,
  renameFile,
} from "../../../automation/desktop/fileOperations.js";
import { openDesktopItem } from "../../../automation/desktop/openDesktopItem.js";
import { openFolder, resolveFolderPath } from "../../../automation/desktop/openFolder.js";import {
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
];

let phase2FilesystemRegistered = false;

export function registerPhase2FilesystemTools(): void {
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

export function resetPhase2FilesystemToolsForTests(): void {
  phase2FilesystemRegistered = false;
}
