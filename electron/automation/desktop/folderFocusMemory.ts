import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FocusContext } from "../../focus/focusContext.js";
import { searchIndexByName } from "../../storage/fileIndex.js";
import { recordFileTouch } from "../../storage/recordFileTouch.js";
import { getMemory, setMemory } from "../../storage/sessionMemory.js";

const WELL_KNOWN: Record<string, () => string> = {
  downloads: () => join(homedir(), "Downloads"),
  documents: () => join(homedir(), "Documents"),
  desktop: () => join(homedir(), "Desktop"),
  pictures: () => join(homedir(), "Pictures"),
  videos: () => join(homedir(), "Videos"),
  music: () => join(homedir(), "Music"),
};

/** `Downloads - File Explorer` → `C:\Users\...\Downloads` */
export function resolveExplorerFolderFromTitle(title: string): string | null {
  const folderName = title
    .replace(/\s*-\s*File Explorer\s*$/i, "")
    .trim();
  if (!folderName) return null;

  const lower = folderName.toLowerCase();
  if (WELL_KNOWN[lower]) {
    const path = WELL_KNOWN[lower]();
    return existsSync(path) ? path : null;
  }

  for (const rootFn of Object.values(WELL_KNOWN)) {
    const root = rootFn();
    const candidate = join(root, folderName);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  const indexed = searchIndexByName(folderName).filter(
    (p) => existsSync(p) && statSync(p).isDirectory(),
  );
  return indexed[0] ?? null;
}

function rememberViewedFolder(path: string, source: string): void {
  const normalized = path.trim();
  if (!normalized || !existsSync(normalized)) return;
  if (!statSync(normalized).isDirectory()) return;

  const prev = getMemory("last_folder");
  setMemory("last_folder", normalized);
  setMemory("last_opened_path", normalized);
  setMemory("last_opened_kind", "folder");
  if (prev !== normalized) {
    recordFileTouch({
      path: normalized,
      command: `viewed folder (${source})`,
      source: "open",
    });
  }
  console.info(
    `[ripple-desktop] memory last_viewed_folder (${source}) → ${normalized}`,
  );
}

/** Remember Explorer folder browsed by the user (P8 long-term via activity_log). */
export function rememberFolderFromFocus(ctx: FocusContext): void {
  if (ctx.processName.toLowerCase() !== "explorer") return;

  const folder = resolveExplorerFolderFromTitle(ctx.windowTitle);
  if (folder) {
    rememberViewedFolder(folder, "explorer-focus");
  }
}
