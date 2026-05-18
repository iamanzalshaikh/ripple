import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env into process.env for the Electron main process (Vite does not always inject these). */
export function loadDesktopEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function getApiBase(): string {
  return (
    process.env.VITE_API_URL ??
    process.env.RIPPLE_API_URL ??
    "http://127.0.0.1:3007/api/v1"
  ).replace(/\/$/, "");
}

/** Socket.IO server origin (no /api/v1 path). */
export function getSocketUrl(): string {
  const explicit = process.env.VITE_SOCKET_URL ?? process.env.RIPPLE_SOCKET_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const api = getApiBase();
  try {
    const u = new URL(api);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://127.0.0.1:3007";
  }
}
