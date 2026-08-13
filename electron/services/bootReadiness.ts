import { apiHealthCheck, type ApiHealthResult } from "./api.js";
import { isNativeClientAuthenticated } from "../native/nativeClient.js";

/** Voice hotkeys stay disabled until sidecar + backend health both pass. */
let voiceInputReady = false;

export function isVoiceInputReady(): boolean {
  return voiceInputReady;
}

export function setVoiceInputReady(ready: boolean): void {
  voiceInputReady = ready;
}

export type HealthWaitOptions = {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  ping?: () => Promise<ApiHealthResult>;
};

/**
 * Retry /health with exponential backoff instead of a single fail-and-forget.
 * Default: ~8 attempts, 250ms → 2s, ~10s budget.
 */
export async function waitForBackendHealth(
  options?: HealthWaitOptions,
): Promise<ApiHealthResult> {
  const attempts = options?.attempts ?? 8;
  const maxDelay = options?.maxDelayMs ?? 2000;
  let delayMs = options?.initialDelayMs ?? 250;
  const ping = options?.ping ?? apiHealthCheck;

  let last: ApiHealthResult = {
    ok: false,
    url: "",
    message: "Health check not started",
  };

  for (let i = 0; i < attempts; i++) {
    last = await ping();
    if (last.ok) {
      if (i > 0) {
        console.info(
          `[ripple-desktop] boot health OK after ${i + 1} attempt(s) (${last.latencyMs ?? "?"}ms)`,
        );
      }
      return last;
    }
    console.warn(
      `[ripple-desktop] boot health attempt ${i + 1}/${attempts} failed — ${last.message}`,
    );
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, maxDelay);
    }
  }
  return last;
}

export type VoiceInputReadyResult = {
  ready: boolean;
  sidecarOk: boolean;
  backendOk: boolean;
};

/**
 * Ready = sidecar authenticated AND /health OK.
 * Sidecar-unavailable (PowerShell fallback) still requires health before hotkeys.
 */
export async function waitUntilVoiceInputReady(
  options?: HealthWaitOptions,
): Promise<VoiceInputReadyResult> {
  const sidecarOk = isNativeClientAuthenticated();
  if (!sidecarOk) {
    console.warn(
      "[ripple-desktop] boot: sidecar not connected — waiting on backend health before Electron hotkeys",
    );
  } else {
    console.info("[ripple-desktop] boot: sidecar connected — waiting on backend /health");
  }

  const health = await waitForBackendHealth(options);
  const ready = sidecarOk && health.ok;
  if (ready) {
    console.info("[ripple-desktop] boot ready — sidecar + backend health OK; enabling hotkeys");
  } else if (health.ok && !sidecarOk) {
    console.warn(
      "[ripple-desktop] boot: backend OK but sidecar down — enabling Electron hotkeys only",
    );
  } else {
    console.warn(
      "[ripple-desktop] boot: backend health never passed — enabling hotkeys anyway (fail-open after wait)",
    );
  }

  return {
    ready: sidecarOk && health.ok,
    sidecarOk,
    backendOk: health.ok,
  };
}
