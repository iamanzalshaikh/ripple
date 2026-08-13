import type { ForegroundWindow } from "./types.js";
import { captureFocusFromForeground } from "../focus/focusContext.js";
import { onNativeEvent } from "./nativeClient.js";
import { isNativeBusy } from "./nativeWatchdog.js";
import { getFocusedA11yElement } from "./win32Bridge.js";

let unsubscribe: (() => void) | null = null;

/**
 * Q5 — while a native insert is in flight (isNativeBusy), log the window
 * class of whatever just stole the foreground. This is the concrete answer
 * to "what's actually stealing focus from Cursor back to explorer/shell
 * right after the hotkey fires" — cheap because it's gated to only the
 * moments that actually matter (mid-insert), not every ordinary alt-tab.
 */
function logFocusStealDuringInsert(event: {
  hwnd: number;
  processName: string;
  windowTitle: string;
}): void {
  if (!isNativeBusy()) return;
  void getFocusedA11yElement()
    .then((a11y) => {
      console.warn(
        `[ripple-focus-steal] mid-insert foreground change → ` +
          `process=${event.processName} hwnd=${event.hwnd} ` +
          `title="${event.windowTitle.slice(0, 60)}" ` +
          `class="${a11y?.className ?? "?"}" role=${a11y?.controlType ?? "?"} ` +
          `name="${(a11y?.name ?? "").slice(0, 60)}"`,
      );
    })
    .catch(() => {
      console.warn(
        `[ripple-focus-steal] mid-insert foreground change → ` +
          `process=${event.processName} hwnd=${event.hwnd} ` +
          `title="${event.windowTitle.slice(0, 60)}" (a11y lookup failed)`,
      );
    });
}

/** Subscribe to sidecar SetWinEventHook foreground events (P7c). */
export function startNativeForegroundBridge(): void {
  stopNativeForegroundBridge();
  unsubscribe = onNativeEvent((event) => {
    if (event.event !== "foreground_changed") return;
    logFocusStealDuringInsert(event);
    const raw: ForegroundWindow = {
      hwnd: event.hwnd,
      processName: event.processName,
      windowTitle: event.windowTitle,
    };
    void captureFocusFromForeground(raw);
  });
}

export function stopNativeForegroundBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}
