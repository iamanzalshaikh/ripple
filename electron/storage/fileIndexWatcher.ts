import { watch } from "node:fs";
import { resolveFolderPath } from "../automation/desktop/openFolder.js";
import { upsertFileIndexPath, rebuildFileIndex } from "./fileIndex.js";
import { getSearchRootKeys } from "./indexConfig.js";
const DEBOUNCE_MS = 3000;

let watchers: ReturnType<typeof watch>[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPaths = new Set<string>();

function scheduleFlush(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const paths = [...pendingPaths];
    pendingPaths.clear();

    if (paths.length > 50) {
      console.info("[ripple-desktop] File watcher: bulk change → index rebuild");
      try {
        rebuildFileIndex();
      } catch (e: unknown) {
        console.warn(
          "[ripple-desktop] Index rebuild after watch failed:",
          e instanceof Error ? e.message : e,
        );
      }
      return;
    }

    for (const p of paths) {
      try {
        upsertFileIndexPath(p);
      } catch {
        /* skip */
      }
    }
  }, DEBOUNCE_MS);
}

/** Phase 4.5+4.7 — keep user folder indexes fresh without full rebuild. */
export function startFileIndexWatcher(): void {
  if (process.platform !== "win32") return;

  for (const rootKey of getSearchRootKeys()) {
    const dir = resolveFolderPath(rootKey);
    try {
      const w = watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        pendingPaths.add(`${dir}\\${filename}`);
        scheduleFlush();
      });
      watchers.push(w);
      console.info(`[ripple-desktop] File watcher active → ${dir}`);
    } catch (e: unknown) {
      console.warn(
        `[ripple-desktop] File watcher skipped for ${rootKey}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
}

export function stopFileIndexWatcher(): void {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  watchers = [];
  if (debounceTimer) clearTimeout(debounceTimer);
}
