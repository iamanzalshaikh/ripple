import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { runInsertText } from "../../../automation/actions/insertText.js";
import { launchNativeApp } from "../../../automation/desktop/launchApp.js";
import { resolveFolderPath } from "../../../automation/desktop/openFolder.js";
import { resolveNativeApp } from "../../../automation/desktop/nativeAppRegistry.js";
import {
  closeAppWindow,
  focusAppWindow,
} from "../../../automation/desktop/windowManager.js";
import type { NativeAppIntent } from "../../../automation/desktop/parseNativeAppCommand.js";
import {
  closeWindowByHwnd,
  focusWindowByHwnd,
  getFocusedA11yElement,
  getForegroundWindow,
} from "../../../native/win32Bridge.js";
import { isHotkeyChord, keysFromDesktopKeyArgs } from "../../../automation/input/keyArgs.js";

import {
  getFocusContext,
  getStableFocusTitles,
  restoreFocusContext,
} from "../../../focus/focusContext.js";
import { resolveEditorWorkspace } from "../../../automation/desktop/parseCreateFileInAppCommand.js";
import { writeFileSafe } from "../../../automation/desktop/fileWrite.js";
import { captureObservation } from "../../observe.js";
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

async function runKeysInsertStep(
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const keys = keysFromDesktopKeyArgs(tool, args);
  if (!keys) {
    return { ok: false, error: `missing_arg:${tool === "desktop.hotkey" ? "chord" : "key"}` };
  }
  if (tool === "desktop.press_key" && isHotkeyChord(keys)) {
    return { ok: false, error: "press_key:use_hotkey_for_chord" };
  }
  if (tool === "desktop.hotkey" && !isHotkeyChord(keys)) {
    return { ok: false, error: "hotkey:need_modifier_chord" };
  }
  return runInsertStep({ tool: "desktop.press_keys", args: { keys } });
}

async function closeWindowExecute(
  args: Record<string, unknown>,
): Promise<ToolResult> {
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

function isIdeWindow(processName: string, windowTitle: string): boolean {
  const p = processName.toLowerCase();
  const t = windowTitle.toLowerCase();
  return (
    p.includes("cursor") ||
    p === "code" ||
    p.includes("visual studio code") ||
    /\s-\s(?:cursor|visual studio code)\s*$/i.test(t)
  );
}

function parseIdeWindowTitle(
  title: string,
): { projectName: string | null; openedFile: string | null } {
  const parts = title
    .split(/\s[-–—]\s/g)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { projectName: null, openedFile: null };
  const last = parts[parts.length - 1]?.toLowerCase() ?? "";
  if (last === "cursor" || last === "visual studio code") {
    parts.pop();
  }
  if (parts.length >= 2) {
    return {
      openedFile: parts.slice(0, -1).join(" - "),
      projectName: parts[parts.length - 1] ?? null,
    };
  }
  return { projectName: parts[0] ?? null, openedFile: null };
}

function candidateRoots(): string[] {
  const roots = new Set<string>();
  const cwd = process.cwd();
  for (let dir = resolve(cwd); dir && dir !== dirname(dir); dir = dirname(dir)) {
    roots.add(dir);
  }
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    roots.add(home);
    roots.add(join(home, "Desktop"));
    roots.add(join(home, "Documents"));
    roots.add(join(home, "Projects"));
    roots.add(join(home, "source"));
    roots.add(join(home, "repos"));
  }
  return [...roots];
}

function resolveWorkspacePath(projectName: string | null): string | null {
  if (!projectName) return null;
  const normalizedProject = projectName.toLowerCase();
  for (const root of candidateRoots()) {
    if (basename(root).toLowerCase() === normalizedProject && existsSync(root)) {
      return root;
    }
    const direct = join(root, projectName);
    if (existsSync(direct)) return direct;
  }
  return null;
}

function findFileByBasename(
  dir: string,
  base: string,
  depth: number,
): string | null {
  if (depth < 0 || !existsSync(dir)) return null;
  try {
    for (const entry of readdirSync(dir)) {
      if (
        entry === "node_modules" ||
        entry === ".git" ||
        entry === "dist" ||
        entry === "out" ||
        entry === "target"
      ) {
        continue;
      }
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && entry.toLowerCase() === base.toLowerCase()) return full;
      if (st.isDirectory()) {
        const nested = findFileByBasename(full, base, depth - 1);
        if (nested) return nested;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Live Cursor/VS Code project + open file from foreground window title. */
export function resolveLiveIdeContext(): {
  application: string;
  windowTitle: string;
  projectName: string | null;
  openedFile: string | null;
  location: string | null;
  filePath: string | null;
} | null {
  const focus = getFocusContext();
  if (!focus?.hwnd) return null;
  const application = focus.processName || "";
  const windowTitle = focus.windowTitle || "";
  if (!isIdeWindow(application, windowTitle)) return null;
  const parsed = parseIdeWindowTitle(windowTitle);
  const location = resolveWorkspacePath(parsed.projectName);
  let filePath: string | null = null;
  if (location && parsed.openedFile) {
    const name = parsed.openedFile.replace(/\s+\(.*?\)\s*$/, "").trim();
    const base = basename(name);
    const candidates = [
      join(location, name),
      join(location, "src", name),
      join(location, "electron", name),
      join(location, "ripple-desktop", name),
      join(location, "ripple-desktop", "electron", name),
      join(location, "ripple-desktop", "electron", "agent", "planner", name),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        filePath = c;
        break;
      }
    }
    if (!filePath && base) {
      for (const root of [location, join(location, "ripple-desktop")].filter((p) =>
        existsSync(p),
      )) {
        const hit = findFileByBasename(root, base, 5);
        if (hit) {
          filePath = hit;
          break;
        }
      }
    }
  }
  return {
    application,
    windowTitle,
    projectName: parsed.projectName,
    openedFile: parsed.openedFile,
    location,
    filePath,
  };
}

async function getCurrentWorkspaceSnapshot(): Promise<ToolResult> {
  const foreground = getFocusContext() ?? (await getForegroundWindow().then((raw) =>
    raw?.hwnd
      ? {
          hwnd: Number(raw.hwnd) || 0,
          processName: raw.processName ?? "",
          windowTitle: raw.windowTitle ?? "",
          activeTabUrl: undefined,
          capturedAt: Date.now(),
          isGmail: false,
          isWhatsApp: false,
          isSlack: false,
          isNotion: false,
          isYouTube: false,
          isLinkedIn: false,
          isInstagram: false,
          isBrowser: /^(?:chrome|msedge|firefox|brave|opera|vivaldi)$/i.test(
            raw.processName ?? "",
          ),
        }
      : null,
  ));
  if (!foreground?.hwnd) {
    return { ok: false, error: "current_workspace:no_foreground_context" };
  }

  const application = foreground.processName || "unknown";
  const windowTitle = foreground.windowTitle || "";
  if (!isIdeWindow(application, windowTitle)) {
    return {
      ok: true,
      output: {
        status: "UNAVAILABLE",
        application,
        windowTitle,
        url: foreground.activeTabUrl ?? null,
        message: foreground.isBrowser
          ? `Current workspace unavailable. You are currently browsing: ${foreground.activeTabUrl ?? (windowTitle || "unknown page")}. No coding workspace detected.`
          : `Current workspace unavailable. Foreground app is ${application || "unknown"}, not Cursor or VS Code.`,
      },
    };
  }

  const parsed = parseIdeWindowTitle(windowTitle);
  const location = resolveWorkspacePath(parsed.projectName);
  return {
    ok: true,
    output: {
      status: location ? "SUCCESS" : "PARTIAL",
      intent: "CURRENT_WORKSPACE",
      project: parsed.projectName,
      application,
      openedFile: parsed.openedFile,
      location,
      windowTitle,
      explanation: parsed.projectName
        ? `You are currently working in ${parsed.projectName}${parsed.openedFile ? `, editing ${parsed.openedFile}` : ""}.`
        : "Cursor/VS Code is focused, but the project name could not be parsed from the window title.",
    },
  };
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
      description: "Send keyboard chords or sequences (compat shim — prefer press_key / hotkey)",
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
      name: "desktop.press_key",
      description: "Press a single key ({ENTER}, {TAB}, a)",
      category: "desktop",
      wave: 2,
      since: "P8.5-P5.2",
      priority: 86,
      cost: 1,
      idempotent: false,
      execution: { timeoutMs: 2000 },
      argsSchema: {
        key: { type: "string", required: true },
      },
      examples: ["press enter", "press tab"],
    }),
    execute: async (_ctx, args) =>
      runKeysInsertStep("desktop.press_key", args),
  },
  {
    definition: def({
      name: "desktop.hotkey",
      description: "Send a modifier chord (^a, ^c, ^+s)",
      category: "desktop",
      wave: 2,
      since: "P8.5-P5.2",
      permissions: ["clipboard"],
      priority: 86,
      cost: 1,
      idempotent: false,
      execution: { timeoutMs: 2000 },
      argsSchema: {
        chord: { type: "string", required: true },
      },
      examples: ["ctrl a", "ctrl shift s"],
    }),
    execute: async (_ctx, args) =>
      runKeysInsertStep("desktop.hotkey", args),
  },
  {
    definition: def({
      name: "desktop.get_active_window",
      description: "Read foreground window hwnd, title, and process",
      category: "desktop",
      wave: 2,
      since: "P8.5-P5.2",
      risk: "low",
      priority: 95,
      cost: 1,
      idempotent: true,
      argsSchema: {},
      examples: ["what window is open", "active window"],
    }),
    execute: async () => {
      const [foreground, focusedField] = await Promise.all([
        getForegroundWindow(),
        getFocusedA11yElement(),
      ]);
      if (!foreground?.hwnd) {
        return { ok: false, error: "no_foreground_window" };
      }
      return {
        ok: true,
        output: {
          hwnd: foreground.hwnd,
          processName: foreground.processName ?? "",
          windowTitle: foreground.windowTitle ?? "",
          focusedField: focusedField
            ? {
                name: focusedField.name ?? "",
                controlType: focusedField.controlType ?? "",
                className: focusedField.className ?? "",
              }
            : null,
        },
      };
    },
  },
  {
    definition: def({
      name: "desktop.get_current_workspace",
      description: "Read live Cursor/VS Code workspace from foreground IDE context",
      category: "desktop",
      wave: 2,
      since: "P8.5-P6",
      risk: "low",
      priority: 96,
      cost: 2,
      idempotent: true,
      argsSchema: {},
      examples: [
        "explain my current workspace",
        "what project am I working on",
        "where am I working right now",
      ],
    }),
    execute: async () => getCurrentWorkspaceSnapshot(),
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
      description: "Close a window (deprecated — use desktop.close_app)",
      category: "desktop",
      risk: "medium",
      argsSchema: {
        app: { type: "string" },
        title: { type: "string" },
        hwnd: { type: "number" },
      },
    }),
    execute: async (_ctx, args) => closeWindowExecute(args),
  },
  {
    definition: def({
      name: "desktop.close_app",
      description: "Close the focused or named application window",
      category: "desktop",
      wave: 2,
      since: "P8.5-P5.2",
      risk: "medium",
      argsSchema: {
        app: { type: "string" },
        title: { type: "string" },
        hwnd: { type: "number" },
      },
      examples: ["close notepad", "close chrome"],
    }),
    execute: async (_ctx, args) => closeWindowExecute(args),
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
      const requestedApp =
        typeof args.app === "string" ? args.app.trim().toLowerCase() : "";
      if (requestedApp === "cursor" || requestedApp === "vscode") {
        let workspace = resolveEditorWorkspace(getStableFocusTitles());
        if (!workspace) {
          const app = resolveNativeApp(requestedApp);
          if (app) {
            await focusAppWindow(app);
            await focusLockAfterAppLaunch();
            await new Promise((r) => setTimeout(r, 350));
          }
          const obs = await captureObservation();
          workspace = resolveEditorWorkspace([
            obs.foreground?.windowTitle,
            ...getStableFocusTitles(),
          ]);
        }
        if (workspace) {
          const fullPath = join(workspace, filename);
          try {
            await writeFileSafe(fullPath, "", { createDirs: true });
            const app = resolveNativeApp(requestedApp);
            if (app) {
              await focusAppWindow(app);
              await focusLockAfterAppLaunch();
            }
            return { ok: true, output: `Created ${fullPath}` };
          } catch (e: unknown) {
            return {
              ok: false,
              error: e instanceof Error ? e.message : "create_file_failed",
            };
          }
        }
      }
      if (requestedApp) {
        const app = resolveNativeApp(requestedApp);
        if (app) {
          try {
            await focusAppWindow(app);
            await focusLockAfterAppLaunch();
            await new Promise((r) => setTimeout(r, 500));
          } catch {
            // Continue save attempt even if explicit pre-focus fails.
          }
        }
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
