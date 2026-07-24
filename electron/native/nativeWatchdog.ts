import {
  isNativeClientAuthenticated,
  pingNativeSidecar,
} from "./nativeClient.js";
import { restartNativeSidecar } from "./nativeSpawn.js";

const PING_INTERVAL_MS = 5000;
const PING_TIMEOUT_MS = 2000;

let timer: ReturnType<typeof setInterval> | null = null;
let checking = false;

/**
 * Sidecar handles RPCs on one thread — a long `run_input_sequence` (char-by-char
 * SendInput) cannot answer ping until it finishes. Without this latch the
 * watchdog kills the sidecar mid-type; Electron then falls through to PowerShell
 * and retypes the full string → duplicated WhatsApp text.
 */
let busyDepth = 0;

export function beginNativeBusy(): void {
  busyDepth += 1;
}

export function endNativeBusy(): void {
  busyDepth = Math.max(0, busyDepth - 1);
}

export function isNativeBusy(): boolean {
  return busyDepth > 0;
}

export function startNativeWatchdog(): void {
  stopNativeWatchdog();

  timer = setInterval(() => {
    void tick();
  }, PING_INTERVAL_MS);

  console.info(
    `[ripple-native] watchdog started — ping every ${PING_INTERVAL_MS}ms`,
  );
}

export function stopNativeWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (checking) return;
  if (!isNativeClientAuthenticated()) return;
  if (isNativeBusy()) return;

  checking = true;
  try {
    const ok = await pingNativeSidecar(PING_TIMEOUT_MS);
    if (!ok) {
      if (isNativeBusy()) return;
      console.warn("[ripple-native] watchdog: ping timeout — restarting sidecar");
      await restartNativeSidecar();
    }
  } catch (e: unknown) {
    if (isNativeBusy()) return;
    console.warn(
      "[ripple-native] watchdog error:",
      e instanceof Error ? e.message : e,
    );
    await restartNativeSidecar();
  } finally {
    checking = false;
  }
}
