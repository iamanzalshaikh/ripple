import { readClipboardText } from "../automation/clipboard/clipboardService.js";
import { getFocusContext, resolveTypingFocusTarget } from "../focus/focusContext.js";
import {
  getFocusedA11yElement,
  getForegroundWindow,
  getCursorPositionNative,
  getWindowUnderCursorNative,
  listVisibleWindowsNative,
} from "../native/win32Bridge.js";
import {
  getSidecarCapabilities,
  isNativeClientAuthenticated,
} from "../native/nativeClient.js";
import { getActiveGoal } from "./goalManager.js";
import type { WorldBrowserSurface, WorldModel } from "./types.js";

function browserSurfaceFromFocus(
  ctx: ReturnType<typeof getFocusContext>,
): WorldBrowserSurface {
  if (!ctx) return null;
  if (ctx.isWhatsApp) return "whatsapp";
  if (ctx.isGmail) return "gmail";
  if (ctx.isInstagram) return "instagram";
  if (ctx.isLinkedIn) return "linkedin";
  if (ctx.isYouTube) return "youtube";
  if (ctx.isNotion) return "notion";
  if (ctx.isSlack) return "slack";
  return null;
}

/** P8.5 — unified environment snapshot for every planner call. */
export async function buildWorldModel(): Promise<WorldModel> {
  const typingTarget = resolveTypingFocusTarget();
  const [foregroundRaw, focusedField, focusContext, cursorPos, windowUnder] =
    await Promise.all([
      getForegroundWindow(),
      getFocusedA11yElement(),
      Promise.resolve(getFocusContext()),
      getCursorPositionNative(),
      getWindowUnderCursorNative(),
    ]);

  const foreground = typingTarget
    ? {
        hwnd: typingTarget.hwnd,
        processName: typingTarget.processName,
        windowTitle: typingTarget.windowTitle,
      }
    : foregroundRaw;

  const clipRaw = readClipboardText();
  const caps = getSidecarCapabilities();
  const sidecarUp = isNativeClientAuthenticated();

  return {
    capturedAt: Date.now(),
    foreground,
    focusedField,
    focusContext,
    mouse: {
      x: cursorPos?.x ?? 0,
      y: cursorPos?.y ?? 0,
      windowUnderCursor: windowUnder
        ? {
            hwnd: windowUnder.hwnd,
            processName: windowUnder.processName,
            windowTitle: windowUnder.windowTitle,
          }
        : null,
      monitorHandle: windowUnder?.monitorHandle,
    },
    browser: {
      surface: browserSurfaceFromFocus(focusContext),
      tabUrl: focusContext?.activeTabUrl,
      windowTitle: focusContext?.windowTitle,
    },
    clipboard: {
      hasText: clipRaw.length > 0,
      preview: clipRaw.slice(0, 120),
      length: clipRaw.length,
    },
    capabilities: {
      sidecarConnected: sidecarUp,
      sendInput: caps?.sendInput === true || process.platform === "win32",
      uia: caps?.uia === true,
      ocr: caps?.ocr === true,
    },
    activeGoal: getActiveGoal(),
  };
}

export async function worldModelForLlm(
  world: WorldModel,
): Promise<Record<string, unknown>> {
  let windowCount: number | undefined;
  try {
    const windows = await listVisibleWindowsNative();
    windowCount = windows.length;
  } catch {
    windowCount = undefined;
  }

  return {
    foreground: world.foreground
      ? {
          hwnd: world.foreground.hwnd,
          processName: world.foreground.processName,
          windowTitle: world.foreground.windowTitle,
        }
      : null,
    focused_field: world.focusedField
      ? {
          name: world.focusedField.name,
          controlType: world.focusedField.controlType,
          className: world.focusedField.className,
        }
      : null,
    mouse: {
      x: world.mouse.x,
      y: world.mouse.y,
      window_under_cursor: world.mouse.windowUnderCursor
        ? {
            processName: world.mouse.windowUnderCursor.processName,
            windowTitle: world.mouse.windowUnderCursor.windowTitle,
          }
        : null,
      monitor_handle: world.mouse.monitorHandle ?? null,
    },
    browser: world.browser,
    clipboard: {
      has_text: world.clipboard.hasText,
      preview: world.clipboard.preview,
      length: world.clipboard.length,
    },
    capabilities: world.capabilities,
    active_goal: world.activeGoal
      ? {
          goal_id: world.activeGoal.goalId,
          summary: world.activeGoal.summary,
          status: world.activeGoal.status,
          step_index: world.activeGoal.stepIndex,
          step_count: world.activeGoal.stepCount,
        }
      : null,
    window_count: windowCount,
  };
}

export function summarizeWorldForLog(world: WorldModel): string {
  const fg = world.foreground;
  const field = world.focusedField?.controlType ?? "none";
  const surf = world.browser.surface ?? "desktop";
  const under = world.mouse.windowUnderCursor?.processName ?? "none";
  return `fg=${fg?.processName ?? "?"} mouse@${under} field=${field} surface=${surf} clip=${world.clipboard.hasText}`;
}
