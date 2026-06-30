import { upsertFileIndexPath } from "../../storage/fileIndex.js";
import { recordFileTouch } from "../../storage/recordFileTouch.js";
import type { Candidate } from "../planner/types.js";

const MAX_CACHE_PATHS = 25;

/**
 * P5.2 — persist Windows Search / retriever hits into file_index cache.
 * Non-blocking best-effort; does not affect retrieval results.
 */
export function cacheRetrieverHits(
  candidates: Candidate[],
  phrase?: string,
): void {
  const paths = candidates
    .filter(
      (c) =>
        c.source === "windows_search" ||
        c.source === "index" ||
        c.source === "local" ||
        c.source === "semantic",
    )
    .map((c) => c.path)
    .slice(0, MAX_CACHE_PATHS);

  const command = phrase?.trim() ? phrase.trim().slice(0, 2000) : undefined;

  for (const path of paths) {
    try {
      upsertFileIndexPath(path);
      recordFileTouch({
        path,
        command,
        source: "retriever",
        logActivity: false,
      });
    } catch {
      /* index cache is optional */
    }
  }
}
