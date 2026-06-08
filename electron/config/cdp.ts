import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function getCdpPort(): number {
  const raw = process.env.RIPPLE_CDP_PORT ?? "9222";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 9222;
}

export function getCdpBrowserUrl(): string {
  const explicit = process.env.RIPPLE_CDP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return `http://127.0.0.1:${getCdpPort()}`;
}

/** Separate Chrome profile so CDP can run while normal Chrome is open. */
export function getCdpUserDataDir(): string {
  const dir =
    process.env.RIPPLE_CDP_PROFILE ??
    join(homedir(), "AppData", "Local", "ripple-cdp-chrome");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Windows Chrome paths (first match wins). */
export function findChromeExecutable(): string | null {
  const candidates = [
    process.env.RIPPLE_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? resolve(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
