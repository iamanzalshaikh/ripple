import {
  isNativeClientAuthenticated,
  pingNativeSidecar,
} from "./nativeClient.js";
import { restartNativeSidecar } from "./nativeSpawn.js";

const PING_INTERVAL_MS = 5000;
const PING_TIMEOUT_MS = 2000;

let timer: ReturnType<typeof setInterval> | null = null;
let checking = false;

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

  checking = true;
  try {
    const ok = await pingNativeSidecar(PING_TIMEOUT_MS);
    if (!ok) {
      console.warn("[ripple-native] watchdog: ping timeout — restarting sidecar");
      await restartNativeSidecar();
    }
  } catch (e: unknown) {
    console.warn(
      "[ripple-native] watchdog error:",
      e instanceof Error ? e.message : e,
    );
    await restartNativeSidecar();
  } finally {
    checking = false;
  }
}
