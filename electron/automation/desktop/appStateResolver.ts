import { findNativeAppById, resolveNativeApp } from "./nativeAppRegistry.js";
import { isAppRunning } from "./windowManager.js";
import type { NativeCommandIntent } from "./parseNativeCommand.js";

/**
 * P5 — if app is already running, focus instead of launching again.
 */
export async function resolveAppLaunchIntent(
  intent: Extract<NativeCommandIntent, { kind: "launch_app" }>,
): Promise<NativeCommandIntent> {
  if (await isAppRunning(intent.app)) {
    return { kind: "switch_app", app: intent.app };
  }
  return intent;
}

export async function applyAppStateBeforeExecute(
  desktopKind: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (desktopKind !== "launch_app") return;
  const appId = typeof data.appId === "string" ? data.appId : "";
  const appLaunch = typeof data.appLaunch === "string" ? data.appLaunch : appId;
  const app = findNativeAppById(appId) ?? resolveNativeApp(appLaunch);
  if (!app) return;
  if (await isAppRunning(app)) {
    data.desktopKind = "switch_app";
    data.appId = app.id;
  }
}
