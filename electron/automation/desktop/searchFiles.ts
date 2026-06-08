import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveFolderPath } from "./openFolder.js";

const SEARCH_ROOTS = ["downloads", "documents", "desktop"] as const;
const MAX_DEPTH = 2;

function listFilesRecursive(dir: string, depth: number, out: string[]): void {
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
    if (st.isFile()) {
      out.push(full);
    } else if (st.isDirectory() && depth < MAX_DEPTH) {
      listFilesRecursive(full, depth + 1, out);
    }
  }
}

/**
 * Find a file by name under Downloads, Documents, Desktop (shallow search).
 */
export function searchFileByName(filename: string): string | null {
  const target = filename.trim().toLowerCase();
  if (!target) return null;

  const matches: string[] = [];
  for (const rootKey of SEARCH_ROOTS) {
    const root = resolveFolderPath(rootKey);
    listFilesRecursive(root, 0, matches);
  }

  const exact = matches.filter((p) => {
    const base = p.split(/[/\\]/).pop()?.toLowerCase();
    return base === target;
  });

  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    exact.sort((a, b) => a.length - b.length);
    return exact[0]!;
  }

  const partial = matches.filter((p) =>
    p.split(/[/\\]/).pop()?.toLowerCase().includes(target),
  );
  if (partial.length === 0) return null;
  partial.sort((a, b) => a.length - b.length);
  return partial[0]!;
}
