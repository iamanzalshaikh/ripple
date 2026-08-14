import { globalShortcut } from "electron";
import {
  cancelVoiceSession,
  handleShortcutPress,
  handleQuickCaptureShortcutPress,
  handleTransformShortcutPress,
  handleMeetingShortcutPress,
  handleDictationHotkeyWithMeetingTripleTap,
} from "../windows/overlay.js";
import {
  isDictationModeEnabled,
  type VoiceUiMode,
} from "../agent/dictation/dictationSession.js";
import { getSidecarCapabilities, isNativeClientAuthenticated } from "./nativeClient.js";

export type HotkeyBinding = {
  accelerator: string;
  label: string;
  action:
    | "command"
    | "dictation"
    | "transform"
    | "voice"
    | "cancel_voice"
    | "quick_capture"
    | "meeting";
};

const DEFAULT_BINDINGS: HotkeyBinding[] = [
  {
    accelerator: "CommandOrControl+Space",
    label: "Command mode",
    action: "command",
  },
  // Primary dictation — Shift+Space. Never Alt+Space: that chord is Windows'
  // reserved "open window system menu" shortcut and RegisterHotKey always fails.
  // Triple-tap Shift+Space (when idle) toggles Meeting Notetaker.
  {
    accelerator: "Shift+Space",
    label: "Dictation mode (triple-tap = meeting)",
    action: "dictation",
  },
  {
    accelerator: "Control+Shift+Space",
    label: "Dictation (backup)",
    action: "dictation",
  },
  {
    accelerator: "Alt+Shift+Space",
    label: "Dictation (legacy backup)",
    action: "dictation",
  },
  // P8 — Transforms: one key (F9). Ctrl+Alt+Space kept as backup only.
  {
    accelerator: "F9",
    label: "Transforms (rewrite selection)",
    action: "transform",
  },
  {
    accelerator: "Control+Alt+Space",
    label: "Transforms (backup)",
    action: "transform",
  },
  // P10.3 lite — Quick capture: new note, opens it, starts dictating.
  {
    accelerator: "Control+Alt+N",
    label: "Quick capture (new note + dictate)",
    action: "quick_capture",
  },
  // P10.2 — Meeting Notetaker toggle.
  {
    accelerator: "Control+Shift+M",
    label: "Meeting Notetaker (start/stop)",
    action: "meeting",
  },
  { accelerator: "Escape", label: "Cancel voice", action: "cancel_voice" },
];

const registered: string[] = [];

function modeForAction(action: HotkeyBinding["action"]): VoiceUiMode {
  if (action === "dictation") {
    if (isDictationModeEnabled()) return "dictation";
    // Loud downgrade — a dictation press routed to the command planner can
    // execute desktop actions (minimize-all, …) from dictated speech.
    console.warn(
      "[ripple-focus-drift] hotkey_mode_downgrade dictation→command (dictation mode disabled at press)",
    );
  }
  return "command";
}

function runHotkeyAction(action: HotkeyBinding["action"]): void {
  if (action === "cancel_voice") {
    cancelVoiceSession();
    return;
  }
  if (action === "transform") {
    void handleTransformShortcutPress();
    return;
  }
  if (action === "quick_capture") {
    void handleQuickCaptureShortcutPress();
    return;
  }
  if (action === "meeting") {
    void handleMeetingShortcutPress();
    return;
  }
  if (action === "dictation") {
    handleDictationHotkeyWithMeetingTripleTap();
    return;
  }
  void handleShortcutPress(modeForAction(action));
}

function sidecarOwnsHotkeys(): boolean {
  return (
    isNativeClientAuthenticated() &&
    getSidecarCapabilities()?.globalHotkey === true
  );
}

/** P7 — register global hotkeys (sidecar RegisterHotKey preferred; Electron fills gaps). */
export function registerNativeHotkeys(
  bindings: HotkeyBinding[] = DEFAULT_BINDINGS,
): { registered: string[]; failed: string[]; source: "sidecar" | "electron" | "mixed" } {
  const ok: string[] = [];
  const failed: string[] = [];

  // Always register Electron bindings too when sidecar is partial / missing a
  // chord. Duplicate RegisterHotKey is fine — Electron globalShortcut fails
  // soft if already taken. Shift+Space is primary dictation; Alt+Space is
  // never registered (Windows reserved system-menu chord).
  const sidecar = sidecarOwnsHotkeys();
  if (sidecar) {
    console.info(
      "[ripple-native] sidecar hotkeys active — also registering Electron backups (Shift+Space=dictation)",
    );
  }

  for (const binding of bindings) {
    if (registered.includes(binding.accelerator)) continue;

    const success = globalShortcut.register(binding.accelerator, () => {
      runHotkeyAction(binding.action);
    });

    if (success) {
      registered.push(binding.accelerator);
      ok.push(binding.accelerator);
      console.info(
        `[ripple-native] hotkey registered: ${binding.accelerator} (${binding.label}) [Electron]`,
      );
    } else {
      failed.push(binding.accelerator);
      console.warn(`[ripple-native] hotkey failed: ${binding.accelerator}`);
    }
  }

  return {
    registered: ok,
    failed,
    source: sidecar ? (ok.length ? "mixed" : "sidecar") : "electron",
  };
}

export function unregisterNativeHotkeys(): void {
  globalShortcut.unregisterAll();
  registered.length = 0;
}

export function listRegisteredHotkeys(): string[] {
  if (sidecarOwnsHotkeys()) {
    return DEFAULT_BINDINGS.map((b) => b.accelerator);
  }
  return [...registered];
}

export function getDefaultHotkeyBindings(): HotkeyBinding[] {
  return [...DEFAULT_BINDINGS];
}
