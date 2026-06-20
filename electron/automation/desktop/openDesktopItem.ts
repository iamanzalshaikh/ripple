import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveItemBySpokenName } from "./itemResolve.js";
import { openFile, openFolder, resolveFolderPath } from "./openFolder.js";

type WellKnownFolder = "downloads" | "documents" | "desktop";

/** Sync resolve for compound send plans — parent folder + spoken name. */
export function resolveKnownItemPath(
  name: string,
  parent: WellKnownFolder,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const parentPath = resolveFolderPath(parent);
  const direct = join(parentPath, trimmed);
  return existsSync(direct) ? direct : null;
}

export async function openDesktopItem(
  name: string,
  parent?: WellKnownFolder,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("No file or folder name given");

  if (parent) {
    const parentPath = resolveFolderPath(parent);
    const direct = join(parentPath, trimmed);
    if (existsSync(direct)) {
      const st = statSync(direct);
      if (st.isDirectory()) {
        return openFolder(direct);
      }
      return openFile(direct);
    }
  }

  const resolved = await resolveItemBySpokenName(trimmed, parent);
  const st = statSync(resolved);
  if (st.isDirectory()) {
    return openFolder(resolved);
  }
  return openFile(resolved);
}
