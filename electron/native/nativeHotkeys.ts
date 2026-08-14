import {
  cancelVoiceSession,
  handleShortcutPress,
} from "../windows/overlay.js";
import {
  isDictationModeEnabled,
  type VoiceUiMode,
} from "../agent/dictation/dictationSession.js";
import { onNativeEvent } from "./nativeClient.js";
import { isVoiceInputReady } from "../services/bootReadiness.js";

let unsubscribe: (() => void) | null = null;

function resolveMode(name: string): VoiceUiMode {
  if (name === "dictation") {
    if (isDictationModeEnabled()) return "dictation";
    // First-run hazard: a dictation hotkey silently downgraded to COMMAND
    // mode routes the spoken text through the planner, which can run desktop
    // actions (e.g. minimize-all). Make the downgrade loud.
    console.warn(
      "[ripple-focus-drift] hotkey_mode_downgrade dictation→command (dictation mode disabled at press)",
    );
  }
  return "command";
}

function handleSidecarHotkey(name: string): void {
  if (!isVoiceInputReady()) {
    console.info(
      `[ripple-native] sidecar hotkey ${name} ignored — still starting up`,
    );
    return;
  }
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
