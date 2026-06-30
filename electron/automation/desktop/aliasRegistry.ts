import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { getAliasesFilePath } from "../../config/ripplePaths.js";
import { normalizeSpokenPath } from "./spokenPath.js";
import { normalizeRegistryKey } from "./spokenName.js";

export type AliasType = "folder" | "file" | "project" | "workspace";

export interface UserAlias {
  name: string;
  type: AliasType;
  path: string;
}

interface AliasStore {
  aliases: Record<string, UserAlias>;
}

let cache: AliasStore | null = null;

function normalizeKey(name: string): string {
  return normalizeRegistryKey(name);
}

function emptyStore(): AliasStore {
  return { aliases: {} };
}

export function loadAliases(): AliasStore {
  if (cache) return cache;

  const file = getAliasesFilePath();
  if (!existsSync(file)) {
    cache = emptyStore();
    return cache;
  }

  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as AliasStore;
    cache = parsed?.aliases ? parsed : emptyStore();
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] aliases.json parse failed:",
      e instanceof Error ? e.message : e,
    );
    cache = emptyStore();
  }

  return cache;
}

export function saveAliases(store: AliasStore): void {
  writeFileSync(getAliasesFilePath(), JSON.stringify(store, null, 2), "utf8");
  cache = store;
}

export function invalidateAliasCache(): void {
  cache = null;
}

export function listUserAliases(): UserAlias[] {
  const store = loadAliases();
  return Object.values(store.aliases).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function getAlias(name: string): UserAlias | null {
  const key = normalizeKey(name);
  const store = loadAliases();
  return store.aliases[key] ?? null;
}

/** Longest alias key match wins (e.g. "my portfolio" before "portfolio"). */
export function resolveAlias(spoken: string): UserAlias | null {
  const store = loadAliases();
  const keys = Object.keys(store.aliases).sort((a, b) => b.length - a.length);
  const raw = normalizeKey(spoken);

  const candidates = [raw];
  if (raw.startsWith("my ")) candidates.push(raw.slice(3));

  for (const candidate of candidates) {
    if (store.aliases[candidate]) return store.aliases[candidate];
  }

  for (const key of keys) {
    for (const candidate of candidates) {
      if (candidate === key) return store.aliases[key];
      if (candidate.endsWith(` ${key}`)) {
        const prefix = candidate.slice(0, candidate.length - key.length - 1).trim();
        const words = prefix ? prefix.split(/\s+/).length : 0;
        if (words <= 2) return store.aliases[key];
      }
    }
  }

  return null;
}

export function inferAliasType(path: string): AliasType {
  const trimmed = path.trim();
  if (/^https?:\/\//i.test(trimmed)) return "workspace";
  if (/\.[a-z0-9]{2,8}$/i.test(trimmed)) return "file";
  if (existsSync(trimmed)) {
    try {
      return statSync(trimmed).isDirectory() ? "folder" : "file";
    } catch {
      return "folder";
    }
  }
  return "folder";
}

export { normalizeSpokenPath } from "./spokenPath.js";

export function addAlias(
  name: string,
  path: string,
  type?: AliasType,
): UserAlias {
  const key = normalizeKey(name);
  if (!key) throw new Error("Alias name cannot be empty");

  const resolvedPath = normalizeSpokenPath(path);
  const entry: UserAlias = {
    name: key,
    type: type ?? inferAliasType(resolvedPath),
    path: resolvedPath,
  };

  const store = loadAliases();
  store.aliases[key] = entry;
  saveAliases(store);

  console.info(`[ripple-desktop] Alias saved: "${key}" → ${entry.path} (${entry.type})`);
  return entry;
}

export function removeAlias(name: string): boolean {
  const key = normalizeKey(name);
  const store = loadAliases();
  if (!store.aliases[key]) return false;
  delete store.aliases[key];
  saveAliases(store);
  console.info(`[ripple-desktop] Alias removed: "${key}"`);
  return true;
}
