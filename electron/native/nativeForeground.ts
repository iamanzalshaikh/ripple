import type { ForegroundWindow } from "./types.js";
import { captureFocusFromForeground } from "../focus/focusContext.js";
import { onNativeEvent } from "./nativeClient.js";

let unsubscribe: (() => void) | null = null;

/** Subscribe to sidecar SetWinEventHook foreground events (P7c). */
export function startNativeForegroundBridge(): void {
  stopNativeForegroundBridge();
  unsubscribe = onNativeEvent((event) => {
    if (event.event !== "foreground_changed") return;
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
