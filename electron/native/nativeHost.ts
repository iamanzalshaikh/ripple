import type { NativeCapabilities } from "./types.js";
import {
  getFocusedA11yElement,
  getForegroundWindow,
  isWin32NativeAvailable,
} from "./win32Bridge.js";
import {
  getSidecarCapabilities,
  isNativeClientAuthenticated,
} from "./nativeClient.js";
import { ensureNativeSidecar, stopNativeSidecar } from "./nativeSpawn.js";
import {
  startNativeWatchdog,
  stopNativeWatchdog,
} from "./nativeWatchdog.js";
import {
  startNativeHotkeyBridge,
  stopNativeHotkeyBridge,
} from "./nativeHotkeys.js";
import {
  startNativeForegroundBridge,
  stopNativeForegroundBridge,
} from "./nativeForeground.js";

let initialized = false;

export function getNativeCapabilities(): NativeCapabilities {
  const win32 = isWin32NativeAvailable();
  const sidecar = getSidecarCapabilities();
  const sidecarUp = isNativeClientAuthenticated();

  return {
    platform: process.platform,
    win32Bridge: win32 || sidecarUp,
    globalHotkeys: true,
    sendInput: sidecar?.sendInput === true || win32,
    accessibility: sidecar?.uia === true || win32,
    ocr: sidecar?.ocr === true,
    sidecarConnected: sidecarUp,
    sidecarProtocol: sidecar?.protocol,
    sidecarVersion: sidecar?.version,
  };
}

/** P7 — spawn sidecar, auth over named pipe, start watchdog, probe OS APIs. */
export async function initNativeHost(): Promise<NativeCapabilities> {
  if (initialized) return getNativeCapabilities();
  initialized = true;

  if (process.platform === "win32") {
    const session = await ensureNativeSidecar();
    if (session) {
      startNativeHotkeyBridge();
      startNativeForegroundBridge();
      startNativeWatchdog();
    } else {
      console.warn(
        "[ripple-native] sidecar unavailable — PowerShell win32Bridge fallback active",
      );
    }
  }

  const caps = getNativeCapabilities();

  console.info(
    `[ripple-native] P7 host ready — sidecar=${caps.sidecarConnected} win32=${caps.win32Bridge} sendInput=${caps.sendInput} a11y=${caps.accessibility} ocr=${caps.ocr === true}`,
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

export function shutdownNativeHost(): void {
  stopNativeForegroundBridge();
  stopNativeHotkeyBridge();
  stopNativeWatchdog();
  stopNativeSidecar();
}

export function isNativeHostReady(): boolean {
  return initialized;
}
