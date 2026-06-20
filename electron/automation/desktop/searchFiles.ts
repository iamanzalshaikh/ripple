import { searchIndexByName, getFileIndexCount } from "../../storage/fileIndex.js";
import { retrieveFileCandidates } from "../retriever/retriever.js";
import { searchDiskByNameOnly } from "./diskSearch.js";

/**
 * Find files or folders by name — P5 canonical retriever chain.
 */
export async function searchItemsByNameAsync(
  spoken: string,
): Promise<string[]> {
  const candidates = await retrieveFileCandidates({
    phrase: spoken,
    token: spoken,
  });
  if (candidates.length > 0) {
    console.info(
      `[ripple-desktop] retriever → ${candidates.length} hit(s) for "${spoken}" (top: ${candidates[0]?.source})`,
    );
    return candidates.map((c) => c.path);
  }
  return [];
}

/** Sync wrapper — index + disk only (legacy callers). */
export function searchItemsByName(spoken: string): string[] {
  const indexed = searchIndexByName(spoken);
  if (indexed.length > 0) return indexed;
  if (getFileIndexCount() > 0) return [];
  return searchDiskByNameOnly(spoken);
}

/** @deprecated use searchItemsByNameAsync */
export function searchFileByName(filename: string): string | null {
  const items = searchItemsByName(filename);
  return items[0] ?? null;
}

export async function searchFileByNameAsync(
  filename: string,
): Promise<string | null> {
  const items = await searchItemsByNameAsync(filename);
  return items[0] ?? null;
}
