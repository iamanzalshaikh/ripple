import { globalShortcut } from "electron";
import {
  cancelVoiceSession,
  handleShortcutPress,
} from "../windows/overlay.js";

export type HotkeyBinding = {
  accelerator: string;
  label: string;
  action: "voice" | "cancel_voice";
};

const DEFAULT_BINDINGS: HotkeyBinding[] = [
  { accelerator: "CommandOrControl+Space", label: "Voice", action: "voice" },
  { accelerator: "Alt+Shift+Space", label: "Voice (fallback)", action: "voice" },
  { accelerator: "Escape", label: "Cancel voice", action: "cancel_voice" },
];

const registered: string[] = [];

function runHotkeyAction(action: HotkeyBinding["action"]): void {
  if (action === "voice") {
    void handleShortcutPress();
  } else {
    cancelVoiceSession();
  }
}

/** P7 — register global hotkeys (Electron + fallback accelerator). */
export function registerNativeHotkeys(
  bindings: HotkeyBinding[] = DEFAULT_BINDINGS,
): { registered: string[]; failed: string[] } {
  const ok: string[] = [];
  const failed: string[] = [];

  for (const binding of bindings) {
    if (registered.includes(binding.accelerator)) continue;

    const success = globalShortcut.register(binding.accelerator, () => {
      runHotkeyAction(binding.action);
    });

    if (success) {
      registered.push(binding.accelerator);
      ok.push(binding.accelerator);
      console.info(`[ripple-native] hotkey registered: ${binding.accelerator} (${binding.label})`);
    } else {
      failed.push(binding.accelerator);
      console.warn(`[ripple-native] hotkey failed: ${binding.accelerator}`);
    }
  }

  return { registered: ok, failed };
}

export function unregisterNativeHotkeys(): void {
  globalShortcut.unregisterAll();
  registered.length = 0;
}

export function listRegisteredHotkeys(): string[] {
  return [...registered];
}
