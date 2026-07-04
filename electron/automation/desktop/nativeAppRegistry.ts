/** Native Windows apps — exe paths or URI schemes. Not web-only adapters. */
export interface NativeAppEntry {
  id: string;
  aliases: string[];
  launch: string;
  /** Process names for switch/close matching (lowercase, no .exe). */
  processNames: string[];
  /** Title keywords when process name alone is ambiguous (e.g. Chrome tabs). */
  titleKeywords?: string[];
}

import {
  loadDiscoveredApps,
  discoveredAppToNativeEntry,
  type DiscoveredApp,
} from "./appDiscovery.js";

/** Web apps handled by extension/backend — never native-launch here. */
export const WEB_ONLY_TARGETS = new Set([
  "gmail",
  "google mail",
  "whatsapp",
  "notion",
  "youtube",
  "linkedin",
  "instagram",
  "mail",
  "email",
  "facebook",
  "twitter",
]);

export const BUILTIN_WINDOWS_APPS: NativeAppEntry[] = [
  {
    id: "calculator",
    aliases: ["calculator", "calc"],
    launch: "calc.exe",
    processNames: ["applicationframehost", "calculator"],
    titleKeywords: ["calculator"],
  },
  {
    id: "paint",
    aliases: ["paint", "ms paint", "microsoft paint"],
    launch: "mspaint.exe",
    processNames: ["mspaint"],
    titleKeywords: ["paint"],
  },
  {
    id: "notepad",
    aliases: ["notepad", "note pad"],
    launch: "notepad.exe",
    processNames: ["notepad"],
    titleKeywords: ["notepad"],
  },
  {
    id: "snipping-tool",
    aliases: ["snipping tool", "snip", "snip and sketch", "snipping"],
    launch: "SnippingTool.exe",
    processNames: ["snippingtool", "screenclippinghost"],
    titleKeywords: ["snip"],
  },
  {
    id: "photos",
    aliases: ["photos", "microsoft photos"],
    launch: "ms-photos:",
    processNames: ["photos", "applicationframehost"],
    titleKeywords: ["photos"],
  },
  {
    id: "camera",
    aliases: ["camera", "webcam"],
    launch: "microsoft.windows.camera:",
    processNames: ["windowscamera", "camera"],
    titleKeywords: ["camera"],
  },
  {
    id: "file-explorer",
    aliases: ["file explorer", "explorer", "files"],
    launch: "explorer.exe",
    processNames: ["explorer"],
    titleKeywords: ["file explorer"],
  },
  {
    id: "clock",
    aliases: ["clock", "alarms", "timer"],
    launch: "ms-clock:",
    processNames: ["applicationframehost"],
    titleKeywords: ["clock"],
  },
  {
    id: "sticky-notes",
    aliases: ["sticky notes", "stickies", "sticky note"],
    launch: "ms-sticky-notes:",
    processNames: ["microsoft", "applicationframehost"],
    titleKeywords: ["sticky notes"],
  },
];

export const COMMON_NATIVE_APPS: NativeAppEntry[] = [
  {
    id: "vscode",
    aliases: ["vs code", "vscode", "visual studio code", "code"],
    launch: "code",
    processNames: ["code"],
    titleKeywords: ["visual studio code"],
  },
  {
    id: "cursor",
    aliases: ["cursor"],
    launch: "cursor",
    processNames: ["cursor"],
    titleKeywords: ["cursor"],
  },
  {
    id: "chrome",
    aliases: ["chrome", "google chrome"],
    launch: "chrome",
    processNames: ["chrome"],
    titleKeywords: ["chrome"],
  },
  {
    id: "edge",
    aliases: ["edge", "microsoft edge"],
    launch: "msedge",
    processNames: ["msedge"],
    titleKeywords: ["edge"],
  },
  {
    id: "firefox",
    aliases: ["firefox"],
    launch: "firefox",
    processNames: ["firefox"],
    titleKeywords: ["firefox"],
  },
  {
    id: "spotify",
    aliases: ["spotify"],
    launch: "spotify",
    processNames: ["spotify"],
    titleKeywords: ["spotify"],
  },
  {
    id: "discord",
    aliases: ["discord"],
    launch: "discord",
    processNames: ["discord"],
    titleKeywords: ["discord"],
  },
  {
    id: "antigravity-ide",
    aliases: [
      "antigravity",
      "antigravity ide",
      "anti gravity",
      "anti-gravity",
      "antigravity-ide",
    ],
    launch: "Antigravity IDE",
    processNames: ["antigravity ide"],
    titleKeywords: ["antigravity"],
  },
  {
    id: "task-manager",
    aliases: ["task manager", "taskmgr"],
    launch: "taskmgr.exe",
    processNames: ["taskmgr"],
    titleKeywords: ["task manager"],
  },
];

const ALL_NATIVE_APPS: NativeAppEntry[] = [
  ...BUILTIN_WINDOWS_APPS,
  ...COMMON_NATIVE_APPS,
];

let aliasIndex: { alias: string; entry: NativeAppEntry }[] = buildAliasIndex(
  ALL_NATIVE_APPS,
);

function buildAliasIndex(
  apps: NativeAppEntry[],
): { alias: string; entry: NativeAppEntry }[] {
  return apps
    .flatMap((entry) =>
      entry.aliases.map((alias) => ({ alias: alias.toLowerCase(), entry })),
    )
    .sort((a, b) => b.alias.length - a.alias.length);
}

/** Merge Start Menu scan results into resolver (Phase 4.5). */
export function mergeDiscoveredApps(apps: DiscoveredApp[]): void {
  const existingIds = new Set(ALL_NATIVE_APPS.map((a) => a.id));
  for (const app of apps) {
    const entry = discoveredAppToNativeEntry(app);
    if (existingIds.has(entry.id)) continue;
    ALL_NATIVE_APPS.push(entry);
    existingIds.add(entry.id);
  }
  aliasIndex = buildAliasIndex(ALL_NATIVE_APPS);
}

export function initNativeAppRegistry(): void {
  mergeDiscoveredApps(loadDiscoveredApps());
}

export function isWebOnlyAppTarget(name: string): boolean {
  return WEB_ONLY_TARGETS.has(name.trim().toLowerCase());
}

export function resolveNativeApp(spoken: string): NativeAppEntry | null {
  const key = spoken.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key || isWebOnlyAppTarget(key)) return null;

  for (const { alias, entry } of aliasIndex) {
    if (key === alias) return entry;
  }

  const clauseKey = key.split(/[,\s]+(?:and|then|write|type|save|paste|click|press)\b/i)[0]?.trim() ?? key;
  const lookupKey = clauseKey.length < key.length ? clauseKey : key;

  for (const { alias, entry } of aliasIndex) {
    if (lookupKey === alias) return entry;
  }

  if (lookupKey === key) {
    for (const { alias, entry } of aliasIndex) {
      if (key.startsWith(`${alias} `) || key.endsWith(` ${alias}`)) return entry;
    }
  }

  return null;
}

export function findNativeAppById(id: string): NativeAppEntry | undefined {
  return ALL_NATIVE_APPS.find((a) => a.id === id);
}
