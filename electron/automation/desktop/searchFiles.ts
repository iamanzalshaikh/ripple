import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveFolderPath } from "./openFolder.js";

const SEARCH_ROOTS = ["downloads", "documents", "desktop"] as const;
const MAX_DEPTH = 3;

function listItemsRecursive(dir: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH || !existsSync(dir)) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() || st.isDirectory()) {
      out.push(full);
    }
    if (st.isDirectory() && depth < MAX_DEPTH) {
      listItemsRecursive(full, depth + 1, out);
    }
  }
}

function rankMatches(target: string, paths: string[]): string[] {
  const exact = paths.filter((p) => basename(p).toLowerCase() === target);
  if (exact.length > 0) {
    return exact.sort((a, b) => a.length - b.length);
  }

  const partial = paths.filter((p) =>
    basename(p).toLowerCase().includes(target),
  );
  return partial.sort((a, b) => a.length - b.length);
}

/**
 * Find files or folders by name under Downloads, Documents, Desktop.
 */
export function searchItemsByName(spoken: string): string[] {
  const target = spoken.trim().toLowerCase();
  if (!target) return [];

  const all: string[] = [];
  for (const rootKey of SEARCH_ROOTS) {
    const root = resolveFolderPath(rootKey);
    listItemsRecursive(root, 0, all);
  }

  return rankMatches(target, all);
}

/** @deprecated use searchItemsByName */
export function searchFileByName(filename: string): string | null {
  const items = searchItemsByName(filename);
  return items[0] ?? null;
}
