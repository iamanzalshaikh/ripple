import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hideOverlay } from "../../windows/overlay.js";
import type { NativeAppEntry } from "./nativeAppRegistry.js";
import { resolveLaunchTarget } from "./resolveLaunchTarget.js";

const execFileAsync = promisify(execFile);

/** Launch a native app by registry entry (exe or URI scheme). */
export async function launchNativeApp(app: NativeAppEntry): Promise<string> {
  hideOverlay();

  if (process.platform !== "win32") {
    throw new Error("Native app launch is only supported on Windows");
  }

  const target = resolveLaunchTarget(app);
  const escaped = target.replace(/'/g, "''");

  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath '${escaped}'`,
    ],
    { windowsHide: true },
  );

  console.info(`[ripple-desktop] Launched ${app.id} → ${target}`);
  return `Opened ${app.aliases[0] ?? app.id}`;
}
