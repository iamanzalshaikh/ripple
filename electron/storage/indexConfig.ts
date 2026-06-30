import { resolveFolderPath } from "../automation/desktop/openFolder.js";

/** Default Ripple search roots (unchanged from Phase 4). */
export const DEFAULT_SEARCH_ROOT_KEYS = [
  "downloads",
  "documents",
  "desktop",
] as const;

export type DefaultSearchRootKey = (typeof DEFAULT_SEARCH_ROOT_KEYS)[number];

let extraSearchRootKeys: string[] = [];

/**
 * Optional narrow index scope — e.g. after user teaches a custom folder alias.
 * Does not remove default roots; only adds more.
 */
export function setExtraSearchRoots(keys: string[]): void {
  extraSearchRootKeys = keys
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
}

export function getExtraSearchRoots(): readonly string[] {
  return extraSearchRootKeys;
}

/** Active roots for file_index rebuild + watchers (defaults + optional extras). */
export function getSearchRootKeys(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const key of [...DEFAULT_SEARCH_ROOT_KEYS, ...extraSearchRootKeys]) {
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(key);
  }

  return out;
}

export function resolveSearchRootPath(rootKey: string): string {
  return resolveFolderPath(rootKey);
}
