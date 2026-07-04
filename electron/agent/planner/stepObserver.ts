import { captureObservation } from "../observe.js";
import type { WorldModel } from "../types.js";
import type { StepObservation, ToolResult } from "./toolTypes.js";

/** P8.5 — thin per-step observation hook (extends P7 observe.ts). */
export async function observeToolStep(
  tool: string,
  args: Record<string, unknown>,
  world: WorldModel,
  result: ToolResult,
): Promise<StepObservation> {
  if (!result.ok) {
    return { ok: false, reason: result.error ?? "step_failed" };
  }

  switch (tool) {
    case "desktop.type_text":
    case "desktop.press_keys":
    case "desktop.copy":
    case "desktop.paste":
    case "desktop.select_all":
      return { ok: true };

    case "desktop.launch_app":
    case "desktop.focus_window": {
      const targetApp =
        typeof args.app === "string"
          ? args.app.toLowerCase()
          : typeof args._nativeIntent === "object" &&
              args._nativeIntent !== null &&
              "app" in args._nativeIntent
            ? String(
                (args._nativeIntent as { app?: { id?: string; name?: string } })
                  .app?.id ??
                  (args._nativeIntent as { app?: { name?: string } }).app
                    ?.name ??
                  "",
              ).toLowerCase()
            : "";
      if (!targetApp) return { ok: true };

      const after = await captureObservation();
      const proc = after.foreground?.processName?.toLowerCase() ?? "";
      const title = after.foreground?.windowTitle?.toLowerCase() ?? "";
      const matched =
        proc.includes(targetApp) ||
        title.includes(targetApp) ||
        targetApp.includes(proc.replace(/\.exe$/, ""));
      return matched
        ? { ok: true }
        : { ok: false, reason: "foreground_mismatch" };
    }

    case "desktop.mouse_click":
    case "desktop.mouse_move":
    case "desktop.mouse_scroll":
      return { ok: true };

    case "desktop.close_window":
      return { ok: true };

    default: {
      if (tool.startsWith("filesystem.")) {
        void world;
        return { ok: true };
      }
      return { ok: true };
    }
  }
}
