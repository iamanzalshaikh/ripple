import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NativeAppEntry } from "./nativeAppRegistry.js";

/** Common Windows install locations when app is not on PATH. */
const INSTALL_CANDIDATES: Record<string, string[]> = {
  vscode: [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft VS Code", "Code.exe"),
    join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Microsoft VS Code",
      "Code.exe",
    ),
  ],
  cursor: [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "cursor", "Cursor.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Cursor", "Cursor.exe"),
  ],
  chrome: [
    join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    join(
      process.env.LOCALAPPDATA ?? "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
  ],
  msedge: [
    join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
  ],
  firefox: [
    join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Mozilla Firefox",
      "firefox.exe",
    ),
  ],
  spotify: [
    join(process.env.APPDATA ?? "", "Spotify", "Spotify.exe"),
  ],
  discord: [
    join(process.env.LOCALAPPDATA ?? "", "Discord", "Update.exe"),
  ],
};

/**
 * Resolve shorthand launch names (code, cursor, chrome) to full exe paths.
 * Falls back to original when already .exe, URI scheme, or on PATH.
 */
export function resolveLaunchTarget(app: NativeAppEntry): string {
  const launch = app.launch.trim();

  if (launch.endsWith(".exe") || /^[a-z][a-z0-9+.-]*:/i.test(launch)) {
    return launch;
  }

  const candidates = INSTALL_CANDIDATES[app.id] ?? [];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      console.info(`[ripple-desktop] Resolved ${app.id} -> ${candidate}`);
      return candidate;
    }
  }

  // VS Code not installed — try Cursor (common for Ripple devs)
  if (app.id === "vscode") {
    for (const candidate of INSTALL_CANDIDATES.cursor ?? []) {
      if (candidate && existsSync(candidate)) {
        console.info(
          `[ripple-desktop] VS Code not found — launching Cursor instead: ${candidate}`,
        );
        return candidate;
      }
    }
  }

  return launch;
}
