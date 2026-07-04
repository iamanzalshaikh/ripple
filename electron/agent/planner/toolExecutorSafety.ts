import {
  checkActionLimit,
  limitMessageFor,
  recordActionUse,
} from "../../automation/safety/actionLimiter.js";
import { confirmIfNeeded } from "../../automation/safety/executionGuard.js";
import type { SafetySlots } from "../../automation/safety/executionSimulator.js";
import { permissionForCommand } from "../../automation/safety/permissionEngine.js";
import { pushUndoAction, type UndoAction } from "../../automation/safety/undoStack.js";
import type {
  CapabilitySnapshot,
  ExecutableToolDefinition,
  ToolResult,
} from "./toolTypes.js";
import { getRegisteredTool } from "./toolRegistry.js";

const SYSTEM_PATH =
  /\b(?:c:|d:|e:)[\\/]|\\windows\\system32\b|\bformat\b.*\bdrive\b/i;

const FILESYSTEM_MUTATORS = new Set([
  "filesystem.delete",
  "filesystem.move",
  "filesystem.rename",
  "filesystem.create",
  "filesystem.create_folder",
]);

/** Map P8.5 tool names → actionLimiter bucket keys. */
const TOOL_RATE_LIMIT_KEY: Record<string, string> = {
  "desktop.launch_app": "launch_app",
  "desktop.focus_window": "switch_app",
  "desktop.close_window": "close_app",
  "filesystem.create": "create_file",
  "filesystem.create_folder": "create_folder",
  "filesystem.delete": "delete_file",
  "filesystem.move": "move_file",
  "filesystem.rename": "rename_file",
};

/** Map P8.5 tools → legacy desktop kinds for confirm/undo. */
const TOOL_DESKTOP_KIND: Record<string, string> = {
  "filesystem.delete": "delete_file",
  "filesystem.move": "move_file",
  "filesystem.rename": "rename_file",
  "filesystem.create": "create_file",
  "filesystem.create_folder": "create_folder",
};

const PATH_ARG_KEYS = [
  "path",
  "paths",
  "from",
  "to",
  "source",
  "destination",
  "target",
  "resolvedPath",
  "backupPath",
] as const;

export function toolToRateLimitKey(tool: string): string {
  return TOOL_RATE_LIMIT_KEY[tool] ?? "default";
}

export function toolToDesktopKind(tool: string): string | null {
  return TOOL_DESKTOP_KIND[tool] ?? null;
}

export function needsPermissionPass2(
  tool: string,
  args: Record<string, unknown>,
): boolean {
  if (FILESYSTEM_MUTATORS.has(tool)) return true;
  return collectResolvedPaths(args).some(hasWildcard);
}

export function collectResolvedPaths(
  args: Record<string, unknown>,
): string[] {
  const paths: string[] = [];
  for (const key of PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(value.trim());
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim()) {
          paths.push(entry.trim());
        }
      }
    }
  }
  return paths;
}

function hasWildcard(path: string): boolean {
  return /[*?[\]{}]/.test(path);
}

/** Step 0 — sliding-window rate limit. */
export function checkRateLimitForTool(tool: string): ToolResult | null {
  const key = toolToRateLimitKey(tool);
  if (checkActionLimit(key)) return null;
  return { ok: false, error: `rate_limit:${limitMessageFor(key)}` };
}

export function recordRateLimitUseForTool(tool: string): void {
  recordActionUse(toolToRateLimitKey(tool));
}

/** Step 1 — category / utterance permission (pass 1). */
export function permissionPass1ForStep(
  tool: string,
  command: string,
  capabilities: CapabilitySnapshot,
): ToolResult | null {
  const registered = getRegisteredTool(tool);
  if (!registered) {
    return { ok: false, error: `unknown_tool:${tool}` };
  }

  const categoryGrant = capabilities.permissions[registered.definition.category];
  if (categoryGrant === "denied") {
    return {
      ok: false,
      error: `permission_denied:${registered.definition.category}`,
    };
  }

  const utterancePerm = permissionForCommand(command);
  if (utterancePerm.level === "blocked") {
    return {
      ok: false,
      error: `permission_blocked:${utterancePerm.reason ?? "blocked"}`,
    };
  }

  return null;
}

/** Step 3 — resolved-path permission (pass 2). Required for filesystem mutators. */
export function permissionPass2ForStep(
  tool: string,
  args: Record<string, unknown>,
): ToolResult | null {
  if (!needsPermissionPass2(tool, args)) return null;

  const paths = collectResolvedPaths(args);

  if (paths.some((p) => hasWildcard(p))) {
    return {
      ok: false,
      error: "permission_blocked:Bulk delete is not allowed.",
    };
  }

  if (paths.some((p) => SYSTEM_PATH.test(p))) {
    return {
      ok: false,
      error: "permission_blocked:System or drive paths cannot be modified.",
    };
  }

  if (tool === "filesystem.delete" && paths.length > 1) {
    return {
      ok: false,
      error: "permission_blocked:Bulk delete is not allowed.",
    };
  }

  return null;
}

function safetySlotsFromArgs(args: Record<string, unknown>): SafetySlots {
  return {
    sourceName:
      typeof args.sourceName === "string"
        ? args.sourceName
        : typeof args.path === "string"
          ? args.path
          : typeof args.from === "string"
            ? args.from
            : undefined,
    newName: typeof args.newName === "string" ? args.newName : undefined,
    destinationFolder:
      typeof args.destinationFolder === "string"
        ? args.destinationFolder
        : typeof args.to === "string"
          ? args.to
          : undefined,
    parentFolder:
      typeof args.parentFolder === "string" ? args.parentFolder : undefined,
    fileName: typeof args.fileName === "string" ? args.fileName : undefined,
    folderName: typeof args.folderName === "string" ? args.folderName : undefined,
  };
}

function needsSafetyConfirmForTool(
  definition: ExecutableToolDefinition,
  tool: string,
): boolean {
  if (definition.risk === "high") return true;
  const kind = toolToDesktopKind(tool);
  return kind !== null;
}

/** Step 4 — P4.5 confirm dialog for medium/high risk mutators. */
export async function confirmStepIfNeeded(
  tool: string,
  args: Record<string, unknown>,
  command: string,
): Promise<ToolResult | null> {
  const registered = getRegisteredTool(tool);
  if (!registered || !needsSafetyConfirmForTool(registered.definition, tool)) {
    return null;
  }

  const kind = toolToDesktopKind(tool);
  if (!kind) return null;

  const data = { ...args, command };
  try {
    await confirmIfNeeded(kind, safetySlotsFromArgs(args), data);
    return null;
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "Cancelled") {
      return { ok: false, error: "safety_cancelled" };
    }
    throw e;
  }
}

/** Step 5 — P4.7 undo stack push before mutating execute (filesystem only). */
export function pushUndoBeforeMutate(
  tool: string,
  args: Record<string, unknown>,
): void {
  const kind = toolToDesktopKind(tool);
  if (!kind) return;

  const paths = collectResolvedPaths(args);
  if (paths.length === 0) return;

  let action: UndoAction | null = null;

  switch (kind) {
    case "delete_file": {
      const path = paths[0]!;
      action = { kind: "delete", path, backupPath: "" };
      break;
    }
    case "move_file": {
      if (paths.length >= 2) {
        action = { kind: "move", from: paths[0]!, to: paths[1]! };
      }
      break;
    }
    case "rename_file": {
      if (paths.length >= 2) {
        action = { kind: "rename", from: paths[0]!, to: paths[1]! };
      }
      break;
    }
    case "create_file":
    case "create_folder": {
      action = { kind: "create", path: paths[0]! };
      break;
    }
    default:
      break;
  }

  if (action) pushUndoAction(action);
}
