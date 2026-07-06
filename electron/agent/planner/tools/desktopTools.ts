import { join } from "node:path";
import { runInsertText } from "../../../automation/actions/insertText.js";
import { launchNativeApp } from "../../../automation/desktop/launchApp.js";
import { resolveFolderPath } from "../../../automation/desktop/openFolder.js";
import { resolveNativeApp } from "../../../automation/desktop/nativeAppRegistry.js";
import {
  closeAppWindow,
  focusAppWindow,
} from "../../../automation/desktop/windowManager.js";
import type { NativeAppIntent } from "../../../automation/desktop/parseNativeCommand.js";
import {
  closeWindowByHwnd,
  focusWindowByHwnd,
} from "../../../native/win32Bridge.js";

import { restoreFocusContext } from "../../../focus/focusContext.js";
import {
  focusLockAfterAppLaunch,
  safeTypingPreflight,
  stepNeedsInputReadyGate,
  submitSaveDialog,
} from "../executionSync.js";
import { insertDataFromPlanStep } from "../executionPlanToPayload.js";
import type { PlanStep } from "../planTypes.js";
import {
  hasRegisteredTool,
  registerTool,
} from "../toolRegistry.js";
import type {
  ExecutableToolDefinition,
  RegisteredTool,
  ToolContext,
  ToolResult,
} from "../toolTypes.js";

function def(
  partial: Omit<ExecutableToolDefinition, "version" | "wave" | "since"> &
    Partial<Pick<ExecutableToolDefinition, "version" | "wave" | "since">>,
): ExecutableToolDefinition {
  return {
    version: "1.0.0",
    since: "P8.5",
    wave: 1,
    risk: "low",
    ...partial,
  };
}

async function runInsertStep(step: PlanStep): Promise<ToolResult> {
  if (stepNeedsInputReadyGate(step.tool)) {
    await safeTypingPreflight();
  }
  const data = insertDataFromPlanStep(step);
  if (!data) {
    return { ok: false, error: `no_insert_data:${step.tool}` };
  }
  try {
    const detail = await runInsertText(data);
    return { ok: true, output: detail };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "insert_text_failed",
    };
  }
}

async function resolveAppFromArgs(
  args: Record<string, unknown>,
): Promise<{ app: NonNullable<ReturnType<typeof resolveNativeApp>> } | ToolResult> {
  const native = args._nativeIntent as NativeAppIntent | undefined;
  if (native && "app" in native && native.app) {
    return { app: native.app };
  }
  const name = typeof args.app === "string" ? args.app.trim() : "";
  if (!name) {
    return { ok: false, error: "missing_arg:app" };
  }
  const app = resolveNativeApp(name);
  if (!app) {
    return { ok: false, error: `app_not_found:${name}` };
  }
  return { app };
}

const DESKTOP_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "desktop.type_text",
      description: "Type literal text into the focused field",
      category: "desktop",
      priority: 80,
      cost: 3,
      idempotent: false,
      execution: { timeoutMs: 2000 },
      argsSchema: {
        text: { type: "string", required: true },
        replaceAll: { type: "boolean" },
        prefocusKeys: { type: "string" },
      },
      examples: ["type hello", "write hello world"],
    }),
    execute: async (_ctx, args) =>
      runInsertStep({
        tool: "desktop.type_text",
        args,
      }),
  },
  {
    definition: def({
      name: "desktop.press_keys",
      description: "Send keyboard chords or sequences",
      category: "desktop",
      permissions: ["clipboard"],
      priority: 85,
      cost: 2,
      idempotent: false,
      execution: { timeoutMs: 2000 },
      argsSchema: {
        keys: { type: "string" },
        sequence: { type: "array" },
      },
    }),
    execute: async (_ctx, args) =>
      runInsertStep({ tool: "desktop.press_keys", args }),
  },
  {
    definition: def({
      name: "desktop.copy",
      description: "Copy selection (Ctrl+C)",
      category: "desktop",
      permissions: ["clipboard"],
      priority: 90,
      cost: 1,
      idempotent: true,
      argsSchema: {},
    }),
    execute: async () =>
      runInsertStep({ tool: "desktop.copy", args: {} }),
  },
  {
    definition: def({
      name: "desktop.paste",
      description: "Paste clipboard (Ctrl+V)",
      category: "desktop",
      permissions: ["clipboard"],
      priority: 90,
      cost: 1,
      idempotent: true,
      argsSchema: {},
    }),
    execute: async () =>
      runInsertStep({ tool: "desktop.paste", args: {} }),
  },
  {
    definition: def({
      name: "desktop.select_all",
      description: "Select all (Ctrl+A)",
      category: "desktop",
      argsSchema: {},
    }),
    execute: async () =>
      runInsertStep({ tool: "desktop.select_all", args: {} }),
  },
  {
    definition: def({
      name: "desktop.mouse_click",
      description: "Click at coordinates or window center",
      category: "desktop",
      argsSchema: {
        x: { type: "number" },
        y: { type: "number" },
        double: { type: "boolean" },
        button: { type: "string" },
      },
    }),
    execute: async (_ctx, args) =>
      runInsertStep({ tool: "desktop.mouse_click", args }),
  },
  {
    definition: def({
      name: "desktop.mouse_move",
      description: "Move mouse relative or absolute",
      category: "desktop",
      argsSchema: {
        x: { type: "number" },
        y: { type: "number" },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        moveToCenter: { type: "boolean" },
      },
    }),
    execute: async (_ctx, args) =>
      runInsertStep({ tool: "desktop.mouse_move", args }),
  },
  {
    definition: def({
      name: "desktop.mouse_scroll",
      description: "Scroll mouse wheel",
      category: "desktop",
      argsSchema: {
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
      },
    }),
    execute: async (_ctx, args) =>
      runInsertStep({ tool: "desktop.mouse_scroll", args }),
  },
  {
    definition: def({
      name: "desktop.mouse_drag",
      description: "Drag mouse to draw shapes on canvas",
      category: "desktop",
      priority: 75,
      cost: 4,
      idempotent: false,
      execution: { timeoutMs: 5000 },
      argsSchema: {
        shape: { type: "string" },
        radius: { type: "number" },
        length: { type: "number" },
        moveToCenter: { type: "boolean" },
      },
      examples: ["draw a circle", "draw a line"],
    }),
    execute: async (_ctx, args) =>
      runInsertStep({ tool: "desktop.mouse_drag", args }),
  },
  {
    definition: def({
      name: "desktop.paint_op",
      description: "Paint fill, erase, or clear canvas",
      category: "desktop",
      priority: 70,
      cost: 3,
      idempotent: false,
      argsSchema: {
        op: { type: "string", required: true },
        text: { type: "string" },
      },
      examples: ["fill it", "erase it", "clear canvas", "label it Hello"],
    }),
    execute: async (_ctx, args) =>
      runInsertStep({ tool: "desktop.paint_op", args }),
  },
  {
    definition: def({
      name: "desktop.launch_app",
      description: "Launch or focus a desktop application",
      category: "desktop",
      priority: 100,
      cost: 5,
      idempotent: true,
      execution: { timeoutMs: 15_000 },
      argsSchema: {
        app: { type: "string", required: true },
      },
      examples: ["open notepad", "launch chrome"],
    }),
    execute: async (_ctx, args) => {
      const resolved = await resolveAppFromArgs(args);
      if (!("app" in resolved)) return resolved;
      try {
        const detail = await launchNativeApp(resolved.app);
        await focusLockAfterAppLaunch();
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "launch_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "desktop.focus_window",
      description: "Bring a window to the foreground",
      category: "desktop",
      argsSchema: {
        app: { type: "string" },
        title: { type: "string" },
        hwnd: { type: "number" },
      },
    }),
    execute: async (_ctx, args) => {
      if (typeof args.hwnd === "number" && args.hwnd > 0) {
        try {
          await focusWindowByHwnd(
            args.hwnd,
            typeof args.title === "string" ? args.title : undefined,
          );
          await focusLockAfterAppLaunch();
          return { ok: true, output: `Focused hwnd=${args.hwnd}` };
        } catch (e: unknown) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : "focus_failed",
          };
        }
      }
      const resolved = await resolveAppFromArgs(args);
      if (!("app" in resolved)) return resolved;
      try {
        const detail = await focusAppWindow(resolved.app);
        await focusLockAfterAppLaunch();
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "focus_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "desktop.close_window",
      description: "Close a window",
      category: "desktop",
      risk: "medium",
      argsSchema: {
        app: { type: "string" },
        title: { type: "string" },
        hwnd: { type: "number" },
      },
    }),
    execute: async (_ctx, args) => {
      if (typeof args.hwnd === "number" && args.hwnd > 0) {
        try {
          await closeWindowByHwnd(args.hwnd);
          return { ok: true, output: `Closed hwnd=${args.hwnd}` };
        } catch (e: unknown) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : "close_failed",
          };
        }
      }
      const resolved = await resolveAppFromArgs(args);
      if (!("app" in resolved)) return resolved;
      try {
        const detail = await closeAppWindow(resolved.app);
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "close_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "desktop.save_file",
      description: "Save the focused editor via Save dialog (Ctrl+S + path)",
      category: "desktop",
      priority: 75,
      cost: 6,
      idempotent: false,
      execution: { timeoutMs: 12_000 },
      argsSchema: {
        filename: { type: "string", required: true },
        folder: { type: "string" },
      },
      examples: [
        "save as meetingnotes.txt in documents",
        "save the file as report.txt in downloads",
      ],
    }),
    execute: async (_ctx, args) => {
      const filename =
        typeof args.filename === "string" ? args.filename.trim() : "";
      if (!filename) {
        return { ok: false, error: "missing_arg:filename" };
      }
      const folderKey =
        typeof args.folder === "string" && args.folder.trim()
          ? args.folder.trim()
          : "downloads";
      const fullPath = join(resolveFolderPath(folderKey), filename);
      const recoveryAttempt = args._saveRecoveryAttempt === true;
      console.info(
        `[ripple-desktop] save target → ${fullPath}${recoveryAttempt ? " (recovery)" : ""}`,
      );
      try {
        await submitSaveDialog(fullPath, { recoveryAttempt });
        return { ok: true, output: `Saved to ${fullPath}` };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "save_file_failed",
        };
      }
    },
  },
];

let phase1Registered = false;

/** Idempotent — registers Phase 1 desktop tools with execute handlers. */
export function registerPhase1DesktopTools(): void {
  for (const tool of DESKTOP_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  phase1Registered = true;
}

export function listPhase1DesktopToolNames(): string[] {
  return DESKTOP_TOOLS.map((t) => t.definition.name);
}

export function resetPhase1DesktopToolsForTests(): void {
  phase1Registered = false;
}
