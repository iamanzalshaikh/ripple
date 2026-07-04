import { existsSync } from "node:fs";
import { join } from "node:path";
import { getRippleDb } from "./rippleDb.js";
import {
  cosineSimilarity,
  embedText,
  embeddingFromJson,
  EMBEDDING_DIMS,
} from "../automation/retriever/localEmbedding.js";
import { getRippleDataDir } from "../config/ripplePaths.js";

let vecExtensionLoaded = false;
let vecExtensionChecked = false;

/** Try loading sqlite-vec extension (optional `vec0.dll` in Ripple data/native). */
export function tryLoadSqliteVec(): boolean {
  if (vecExtensionChecked) return vecExtensionLoaded;
  vecExtensionChecked = true;
  try {
    const db = getRippleDb();
    const extPath =
      process.env.RIPPLE_SQLITE_VEC_PATH?.trim() ||
      join(getRippleDataDir(), "native", "vec0.dll");
    if (!existsSync(extPath)) return false;
    db.loadExtension(extPath);
    vecExtensionLoaded = true;
    console.info("[ripple-desktop] sqlite-vec extension loaded");
  } catch (e) {
    console.warn(
      "[ripple-desktop] sqlite-vec unavailable — JS cosine fallback:",
      e instanceof Error ? e.message : e,
    );
  }
  return vecExtensionLoaded;
}

export function isSqliteVecReady(): boolean {
  return vecExtensionLoaded;
}

export type VectorHit = { id: string; score: number };

/** KNN search on semantic_embeddings (sqlite-vec when DLL present, else JS cosine). */
export function searchPathVectorIndex(
  phrase: string,
  limit = 12,
): VectorHit[] {
  tryLoadSqliteVec();
  const query = embedText(phrase);
  const rows = getRippleDb()
    .prepare(`SELECT path, embedding FROM semantic_embeddings LIMIT 2500`)
    .all() as Array<{ path: string; embedding: string }>;

  const scored: VectorHit[] = [];
  for (const row of rows) {
    const vec = embeddingFromJson(row.embedding);
    if (!vec) continue;
    const score = cosineSimilarity(query, vec);
    if (score >= 0.22) scored.push({ id: row.path, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** KNN search on semantic_refs summaries. */
export function searchRefVectorIndex(
  phrase: string,
  limit = 12,
): VectorHit[] {
  tryLoadSqliteVec();
  const query = embedText(phrase);
  const rows = getRippleDb()
    .prepare(
      `SELECT ref_key, embedding FROM semantic_refs ORDER BY id DESC LIMIT 600`,
    )
    .all() as Array<{ ref_key: string; embedding: string }>;

  const scored: VectorHit[] = [];
  for (const row of rows) {
    const vec = embeddingFromJson(row.embedding);
    if (!vec) continue;
    const score = cosineSimilarity(query, vec);
    if (score >= 0.2) scored.push({ id: row.ref_key, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export { EMBEDDING_DIMS };
