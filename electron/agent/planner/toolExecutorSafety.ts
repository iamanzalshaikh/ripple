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
import { createBackupIfExists } from "../../automation/desktop/fileWrite.js";
import { getRegisteredTool } from "./toolRegistry.js";

/** Truly protected locations — not every absolute path. */
const PROTECTED_PATH_SEGMENT =
  /[\\/](?:windows|system32|program files(?: \(x86\))?|programdata|\$recycle\.bin|system volume information)(?:[\\/]|$)/i;
const DRIVE_ROOT_FILE = /^[a-z]:[\\/][^\\/]*$/i;

export function isProtectedSystemPath(path: string): boolean {
  const p = path.trim();
  if (!p) return false;
  if (PROTECTED_PATH_SEGMENT.test(p)) return true;
  // Writing directly into a drive root (C:\file.txt) — block; deeper paths are fine.
  if (DRIVE_ROOT_FILE.test(p)) return true;
  return false;
}

const FILESYSTEM_MUTATORS = new Set([
  "filesystem.delete",
  "filesystem.move",
  "filesystem.move_file",
  "filesystem.move_folder",
  "filesystem.copy_file",
  "filesystem.copy_folder",
  "filesystem.rename",
  "filesystem.create",
  "filesystem.create_file",
  "filesystem.create_folder",
  "filesystem.write_file",
  "filesystem.patch_file",
]);

const AUTOMATION_MUTATORS = new Set([
  "automation.run_command",
  "automation.run_script",
  "automation.git_operation",
  "automation.run_tests",
  "os.run_as_admin",
]);

const AUTOMATION_CONFIRM_KIND: Record<string, string> = {
  "automation.run_command": "run_command",
  "automation.run_script": "run_script",
  "automation.git_operation": "git_operation",
  "automation.run_tests": "run_tests",
  "os.run_as_admin": "run_as_admin",
};

/** Map P8.5 tool names → actionLimiter bucket keys. */
const TOOL_RATE_LIMIT_KEY: Record<string, string> = {
  "desktop.launch_app": "launch_app",
  "desktop.focus_window": "switch_app",
  "desktop.close_window": "close_app",
  "desktop.close_app": "close_app",
  "filesystem.create": "create_file",
  "filesystem.create_file": "create_file",
  "filesystem.create_folder": "create_folder",
  "filesystem.delete": "delete_file",
  "filesystem.move": "move_file",
  "filesystem.move_file": "move_file",
  "filesystem.move_folder": "move_file",
  "filesystem.copy_file": "copy_file",
  "filesystem.copy_folder": "copy_file",
  "filesystem.rename": "rename_file",
  "filesystem.write_file": "write_file",
  "filesystem.patch_file": "patch_file",
  "automation.run_command": "run_command",
  "automation.run_script": "run_script",
  "automation.git_operation": "git_operation",
  "automation.run_tests": "run_tests",
  "os.run_as_admin": "run_as_admin",
  "ai.summarize_screen": "ai_tool",
  "ai.extract_context": "ai_tool",
  "ai.detect_element": "ai_tool",
  "ai.reason_about_task": "ai_tool",
  "ai.generate_action_plan": "ai_tool",
};

/** Map P8.5 tools → legacy desktop kinds for confirm/undo. */
const TOOL_DESKTOP_KIND: Record<string, string> = {
  "filesystem.delete": "delete_file",
  "filesystem.move": "move_file",
  "filesystem.move_file": "move_file",
  "filesystem.move_folder": "move_file",
  "filesystem.copy_file": "copy_file",
  "filesystem.copy_folder": "copy_file",
  "filesystem.rename": "rename_file",
  "filesystem.create": "create_file",
  "filesystem.create_file": "create_file",
  "filesystem.create_folder": "create_folder",
  "filesystem.write_file": "write_file",
  "filesystem.patch_file": "patch_file",
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
  "cwd",
  "projectRoot",
  "scriptPath",
] as const;

export function toolToRateLimitKey(tool: string): string {
  return TOOL_RATE_LIMIT_KEY[tool] ?? "default";
}

export function toolToDesktopKind(tool: string): string | null {
  return TOOL_DESKTOP_KIND[tool] ?? AUTOMATION_CONFIRM_KIND[tool] ?? null;
}

export function needsPermissionPass2(
  tool: string,
  args: Record<string, unknown>,
): boolean {
  if (FILESYSTEM_MUTATORS.has(tool)) return true;
  if (AUTOMATION_MUTATORS.has(tool)) return true;
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

  if (paths.some((p) => isProtectedSystemPath(p))) {
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
      typeof args.path === "string"
        ? args.path
        : typeof args.sourceName === "string"
          ? args.sourceName
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
    command: typeof args.command === "string" ? args.command : undefined,
    scriptPath: typeof args.scriptPath === "string" ? args.scriptPath : undefined,
    operation: typeof args.operation === "string" ? args.operation : undefined,
    app:
      typeof args.app === "string"
        ? args.app
        : typeof args.path === "string"
          ? args.path
          : undefined,
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
  reason?: string,
): Promise<ToolResult | null> {
  if (tool === "automation.run_tests" && process.env.RIPPLE_P85_AUTO_TEST === "1") {
    return null;
  }

  // CODE_REPAIR patches are already voice-authorized ("apply the safe fixes" / "yes").
  // Do not show a second Electron Confirm/Cancel popup.
  if (
    tool === "filesystem.patch_file" &&
    typeof reason === "string" &&
    /^code_repair_patch_/i.test(reason)
  ) {
    console.info(
      `[ripple-p85] safety: skip patch confirm (pre-authorized ${reason})`,
    );
    return null;
  }

  // Tests already requested in the same developer-workflow utterance as apply/fix.
  if (
    tool === "automation.run_tests" &&
    reason === "developer_workflow_run_tests" &&
    /\b(?:apply|fix|yes|confirm)\b/i.test(command) &&
    /\btests?\b/i.test(command)
  ) {
    console.info(
      "[ripple-p85] safety: skip run_tests confirm (workflow already authorized)",
    );
    return null;
  }

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
    case "write_file":
    case "patch_file": {
      const path = paths[0]!;
      const backup = createBackupIfExists(path);
      if (backup) {
        action = { kind: "restore_file", path, backupPath: backup };
      } else {
        action = { kind: "create", path };
      }
      break;
    }
    default:
      break;
  }

  if (action) pushUndoAction(action);
}
