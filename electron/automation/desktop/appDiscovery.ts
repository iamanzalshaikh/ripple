import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import { join } from "node:path";
import { getRippleDataDir } from "../../config/ripplePaths.js";
import type { NativeAppEntry } from "./nativeAppRegistry.js";

const execFileAsync = promisify(execFile);

export type DiscoveredApp = {
  name: string;
  appId: string;
  launch: string;
};

const discoveredAppsPath = () => join(getRippleDataDir(), "discovered_apps.json");

let cache: DiscoveredApp[] | null = null;

function psEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/** Scan Windows Start Menu apps via PowerShell Get-StartApps. */
export async function scanInstalledApps(): Promise<DiscoveredApp[]> {
  if (process.platform !== "win32") return [];

  const script = `
    Get-StartApps | ForEach-Object {
      [PSCustomObject]@{ Name = $_.Name; AppId = $_.AppID }
    } | ConvertTo-Json -Compress
  `;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );

    const trimmed = stdout.trim();
    if (!trimmed) return [];

    const parsed = JSON.parse(trimmed) as
      | { Name: string; AppId: string }
      | { Name: string; AppId: string }[];

    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const apps: DiscoveredApp[] = [];

    for (const row of rows) {
      const name = row.Name?.trim();
      const appId = row.AppId?.trim();
      if (!name || !appId) continue;

      const launch =
        appId.includes("!") || appId.includes("\\")
          ? `shell:AppsFolder\\${appId}`
          : appId;

      apps.push({ name, appId, launch });
    }

    writeFileSync(
      discoveredAppsPath(),
      JSON.stringify({ apps, scanned_at: new Date().toISOString() }, null, 2),
      "utf8",
    );
    cache = apps;
    console.info(`[ripple-desktop] App discovery: ${apps.length} Start Menu apps`);
    return apps;
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] App discovery failed:",
      e instanceof Error ? e.message : e,
    );
    return loadDiscoveredApps();
  }
}

export function loadDiscoveredApps(): DiscoveredApp[] {
  if (cache) return cache;
  const path = discoveredAppsPath();
  if (!existsSync(path)) {
    cache = [];
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { apps?: DiscoveredApp[] };
    cache = raw.apps ?? [];
  } catch {
    cache = [];
  }
  return cache;
}

export function discoveredAppToNativeEntry(app: DiscoveredApp): NativeAppEntry {
  const id = app.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  const aliases = [
    app.name.toLowerCase(),
    ...app.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
  ];

  return {
    id: id || "discovered-app",
    aliases: [...new Set(aliases)],
    launch: app.launch.startsWith("shell:") ? app.launch : `shell:AppsFolder\\${app.appId}`,
    processNames: [basename(app.name).toLowerCase().replace(/\s+/g, "")],
    titleKeywords: [app.name.toLowerCase()],
  };
}

let scanInFlight = false;

export function startAppDiscoveryBackground(): void {
  if (scanInFlight || process.platform !== "win32") return;
  scanInFlight = true;

  setTimeout(() => {
    scanInstalledApps()
      .catch(() => {})
      .finally(() => {
        scanInFlight = false;
      });
  }, 4000);
}
