import { globalShortcut } from "electron";
import {
  cancelVoiceSession,
  handleShortcutPress,
} from "../windows/overlay.js";

const VOICE_ACCELERATOR = "CommandOrControl+Space";

export function registerGlobalShortcuts(): void {
  const voiceOk = globalShortcut.register(VOICE_ACCELERATOR, () => {
    void handleShortcutPress();
  });
  if (!voiceOk) {
    console.warn(`[shortcuts] Failed to register ${VOICE_ACCELERATOR}`);
  }

  const escOk = globalShortcut.register("Escape", () => {
    cancelVoiceSession();
  });
  if (!escOk) {
    console.warn("[shortcuts] Failed to register Escape (cancel voice)");
  }
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}
