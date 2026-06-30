import { join } from "node:path";
import { resolveFolderPath } from "../desktop/openFolder.js";
import type { Candidate } from "../planner/types.js";

function resolveParentFolderPath(parent?: string): string | null {
  if (!parent?.trim()) return null;

  const raw = parent.trim();
  const key = raw.toLowerCase();

  if (key.startsWith("download")) return resolveFolderPath("downloads");
  if (key.startsWith("document")) return resolveFolderPath("documents");
  if (key === "desktop") return resolveFolderPath("desktop");

  const embedded = key.match(/\b(?:in\s+)?(downloads?|documents?|desktop)\b/);
  if (embedded?.[1]) {
    const k = embedded[1];
    if (k.startsWith("download")) return resolveFolderPath("downloads");
    if (k.startsWith("document")) return resolveFolderPath("documents");
    return resolveFolderPath("desktop");
  }

  if (/^[a-z]:\\/i.test(raw) || raw.startsWith("\\\\")) {
    return raw;
  }

  return join(resolveFolderPath("desktop"), raw);
}

/**
 * Narrow candidates to a parent folder when a hint is provided.
 * Falls back to the full list if the filter would remove every hit.
 */
export function filterCandidatesByParentFolder(
  candidates: Candidate[],
  parentFolder?: string,
): Candidate[] {
  if (!parentFolder?.trim() || candidates.length === 0) {
    return candidates;
  }

  const parentPath = resolveParentFolderPath(parentFolder);
  if (!parentPath) return candidates;

  const prefix = parentPath.replace(/[\\/]+$/, "").toLowerCase();
  const filtered = candidates.filter((c) => {
    const p = c.path.toLowerCase();
    return p === prefix || p.startsWith(`${prefix}\\`);
  });

  return filtered.length > 0 ? filtered : candidates;
}
