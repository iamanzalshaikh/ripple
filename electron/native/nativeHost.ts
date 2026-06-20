import type { NativeCapabilities } from "./types.js";
import {
  getFocusedA11yElement,
  getForegroundWindow,
  isWin32NativeAvailable,
} from "./win32Bridge.js";

let initialized = false;

export function getNativeCapabilities(): NativeCapabilities {
  const win32 = isWin32NativeAvailable();
  return {
    platform: process.platform,
    win32Bridge: win32,
    globalHotkeys: true,
    sendInput: win32,
    accessibility: win32,
  };
}

/** P7 — initialize native OS layer (probe + log capabilities). */
export async function initNativeHost(): Promise<NativeCapabilities> {
  const caps = getNativeCapabilities();
  if (initialized) return caps;
  initialized = true;

  console.info(
    `[ripple-native] P7 host ready — win32=${caps.win32Bridge} sendInput=${caps.sendInput} a11y=${caps.accessibility}`,
  );

  if (caps.win32Bridge) {
    const fg = await getForegroundWindow();
    if (fg) {
      console.info(
        `[ripple-native] foreground: "${fg.windowTitle}" (${fg.processName}) hwnd=${fg.hwnd}`,
      );
    }
    const a11y = await getFocusedA11yElement();
    if (a11y?.name) {
      console.info(
        `[ripple-native] a11y focus: ${a11y.controlType} "${a11y.name}"`,
      );
    }
  }

  return caps;
}

export function isNativeHostReady(): boolean {
  return initialized;
}
