import { existsSync } from "node:fs";
import { join } from "node:path";
import { pickItemFromMatches } from "./disambiguation.js";
import { resolveFolderPath } from "./openFolder.js";
import { retrieveFileCandidates } from "../retriever/retriever.js";
import { setCapabilityCacheEntry } from "../../storage/capabilityCache.js";

function resolveParentPath(name?: string): string {
  if (!name?.trim()) return resolveFolderPath("desktop");
  const raw = name.trim();
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

  return resolveFolderPath("desktop");
}

/**
 * Resolve spoken name to a file or folder path.
 * Uses optional folder hint, then search, then disambiguation dialog.
 */
export async function resolveItemBySpokenName(
  spoken: string,
  parent?: string,
): Promise<string> {
  const trimmed = spoken.trim();
  if (!trimmed) {
    throw new Error("No file or folder name given");
  }

  if (/[\\/]/.test(trimmed) && existsSync(trimmed)) {
    return trimmed;
  }

  // Absolute Windows path that doesn't currently exist — still return it so
  // callers can emit a clear source_not_found instead of searching Desktop.
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) {
    return trimmed;
  }

  if (parent) {
    const parentPath = resolveParentPath(parent);
    const direct = join(parentPath, trimmed);
    if (existsSync(direct)) return direct;
  }

  const candidates = await retrieveFileCandidates({
    phrase: trimmed,
    token: trimmed,
    parentFolder: parent,
  });
  const matches = candidates.map((c) => c.path);

  if (matches.length === 0) {
    const hint = parent ? ` in ${parent}` : "";
    throw new Error(
      `Not found: "${trimmed}"${hint} (searched Downloads, Documents, Desktop — say e.g. "Rename Flow in Downloads to Heroids")`,
    );
  }

  if (matches.length === 1) {
    console.info(`[ripple-desktop] Resolved "${trimmed}" → ${matches[0]}`);
    setCapabilityCacheEntry(trimmed, matches[0]!, 0.92);
    return matches[0]!;
  }

  const picked = await pickItemFromMatches(trimmed, matches);
  if (!picked) {
    throw new Error("Cancelled — pick which file or folder you meant");
  }

  console.info(`[ripple-desktop] Resolved "${trimmed}" → ${picked} (user picked)`);
  setCapabilityCacheEntry(trimmed, picked, 0.95);
  return picked;
}
