import {
  cancelVoiceSession,
  handleShortcutPress,
} from "../windows/overlay.js";
import {
  isDictationModeEnabled,
  type VoiceUiMode,
} from "../agent/dictation/dictationSession.js";
import { onNativeEvent } from "./nativeClient.js";

let unsubscribe: (() => void) | null = null;

function resolveMode(name: string): VoiceUiMode {
  if (name === "dictation" && isDictationModeEnabled()) return "dictation";
  return "command";
}

function handleSidecarHotkey(name: string): void {
  if (name === "cancel_voice") {
    cancelVoiceSession();
    return;
  }
  // "voice" kept as command alias for older sidecar builds
  if (name === "command" || name === "voice" || name === "dictation") {
    void handleShortcutPress(resolveMode(name));
  }
}

/** Subscribe to sidecar RegisterHotKey events (P7). */
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
