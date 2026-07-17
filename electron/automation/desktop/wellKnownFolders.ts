import { homedir } from "node:os";
import { join } from "node:path";

type WellKnownKey = "documents" | "downloads" | "desktop";

const HOMEDIR_FALLBACK: Record<WellKnownKey, () => string> = {
  documents: () => join(homedir(), "Documents"),
  downloads: () => join(homedir(), "Downloads"),
  desktop: () => join(homedir(), "Desktop"),
};

let electronPaths: Partial<Record<WellKnownKey, string>> | null = null;

function loadElectronPaths(): Partial<Record<WellKnownKey, string>> {
  if (electronPaths) return electronPaths;
  electronPaths = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    electronPaths.documents = app.getPath("documents");
    electronPaths.downloads = app.getPath("downloads");
    electronPaths.desktop = app.getPath("desktop");
  } catch {
    /* vitest / non-electron */
  }
  return electronPaths;
}

/** OS-resolved user folder (Electron known-folder path when available). */
export function wellKnownFolderPath(key: WellKnownKey): string {
  const fromElectron = loadElectronPaths()[key];
  return fromElectron ?? HOMEDIR_FALLBACK[key]();
}

export function resolveWellKnownFolderKey(name?: string): WellKnownKey | null {
  if (!name?.trim()) return null;
  const key = name.trim().toLowerCase();
  if (key.startsWith("download")) return "downloads";
  if (key.startsWith("document")) return "documents";
  if (key === "desktop") return "desktop";
  const embedded = key.match(/\b(?:in\s+)?(downloads?|documents?|desktop)\b/);
  if (!embedded?.[1]) return null;
  const part = embedded[1];
  if (part.startsWith("download")) return "downloads";
  if (part.startsWith("document")) return "documents";
  return "desktop";
}
