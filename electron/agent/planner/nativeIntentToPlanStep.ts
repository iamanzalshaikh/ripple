import type { NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import type { PlanStep } from "./planTypes.js";
import { openIntentToPlanSteps } from "./l0FileOpPlanner.js";
import type { DesktopOpenIntent } from "../../automation/desktop/parseDesktopCommand.js";
import { resolveTabTargetFromWorkspace } from "../../automation/browser/browserTabResolver.js";
import { buildBrowserSearchUrl } from "../../automation/browser/parseBrowserWorkspaceSearch.js";

/**
 * Map a strict native intent to a P8.5 executable plan step (no payload bridge).
 */
export function nativeIntentToPlanStep(
  intent: NativeCommandIntent,
): PlanStep | null {
  switch (intent.kind) {
    case "launch_app":
      return {
        tool: "desktop.launch_app",
        args: {
          app: intent.app.id,
          _nativeIntent: intent,
        },
        reason: "launch_app",
      };
    case "switch_app":
      return {
        tool: "desktop.focus_window",
        args: {
          app: intent.app.id,
          _nativeIntent: intent,
        },
        reason: "switch_app",
      };
    case "close_app":
      return {
        tool: "desktop.close_window",
        args: {
          app: intent.app.id,
          _nativeIntent: intent,
        },
        reason: "close_app",
      };
    case "type_text": {
      if (intent.text?.trim()) {
        return {
          tool: "desktop.type_text",
          args: {
            text: intent.text.trim(),
            ...(intent.replaceAll ? { replaceAll: true } : {}),
          },
          reason: "type_text",
        };
      }
      if (intent.keys) {
        return {
          tool: "desktop.press_keys",
          args: { keys: intent.keys },
          reason: "press_keys",
        };
      }
      if (intent.sequence?.length) {
        return {
          tool: "desktop.press_keys",
          args: { sequence: intent.sequence },
          reason: "key_sequence",
        };
      }
      return null;
    }
    case "folder":
    case "file":
    case "item":
      return openIntentToPlanSteps(intent as DesktopOpenIntent)[0] ?? null;
    case "open_resolved":
      return {
        tool: "filesystem.open",
        args: { path: intent.path },
        reason: "open_resolved",
      };
    case "open_alias":
      return {
        tool: "desktop.launch_app",
        args: { _nativeIntent: intent },
        reason: "open_alias",
      };
    case "open_workspace":
      return {
        tool: "browser.open_workspace",
        args: {
          workspaceId: intent.workspace.id,
          url: intent.workspace.url,
          tabTarget: resolveTabTargetFromWorkspace(intent.workspace),
          _nativeIntent: intent,
        },
        reason: "open_workspace",
      };
    case "browser_search":
      return {
        tool: "browser.search_workspace",
        args: {
          query: intent.query,
          url: buildBrowserSearchUrl(intent.query),
          tabTarget: { type: "url", url: buildBrowserSearchUrl(intent.query), label: intent.query },
          _nativeIntent: intent,
        },
        reason: "browser_search",
      };
    case "save_file":
      return {
        tool: "desktop.save_file",
        args: {
          filename: intent.filename,
          ...(intent.folder ? { folder: intent.folder } : {}),
        },
        reason: "save_file",
      };
    default:
      return null;
  }
}

export function nativeIntentsToPlanSteps(
  intents: NativeCommandIntent[],
): PlanStep[] | null {
  const steps: PlanStep[] = [];
  for (const intent of intents) {
    const step = nativeIntentToPlanStep(intent);
    if (!step) return null;
    steps.push(step);
  }
  return steps;
}
