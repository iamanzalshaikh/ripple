import {
  cancelVoiceSession,
  handleShortcutPress,
} from "../windows/overlay.js";
import { onNativeEvent } from "./nativeClient.js";

let unsubscribe: (() => void) | null = null;

function handleSidecarHotkey(name: string): void {
  if (name === "voice") {
    void handleShortcutPress();
    return;
  }
  if (name === "cancel_voice") {
    cancelVoiceSession();
  }
}

/** Subscribe to sidecar RegisterHotKey events (P7b). */
export function startNativeHotkeyBridge(): void {
  stopNativeHotkeyBridge();
  unsubscribe = onNativeEvent((event) => {
    if (event.event === "hotkey") {
      handleSidecarHotkey(event.name);
    }
  });
}

export function stopNativeHotkeyBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}
