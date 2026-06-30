import { createHash } from "node:crypto";
import { getRippleDb } from "./rippleDb.js";
import {
  cosineSimilarity,
  embedText,
  embeddingFromJson,
  embeddingToJson,
  EMBEDDING_DIMS,
} from "../automation/retriever/localEmbedding.js";

function ensureTables(): void {
  getRippleDb();
}

export function upsertPathEmbedding(path: string, text: string): void {
  ensureTables();
  const normalized = path.trim();
  if (!normalized || !text.trim()) return;

  const vec = embedText(text);
  const now = new Date().toISOString();

  getRippleDb()
    .prepare(
      `INSERT INTO semantic_embeddings (path, dims, embedding, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         dims = excluded.dims,
         embedding = excluded.embedding,
         updated_at = excluded.updated_at`,
    )
    .run(normalized, EMBEDDING_DIMS, embeddingToJson(vec), now);
}

export type SemanticRef = {
  id: number;
  refKey: string;
  appId: string | null;
  contact: string | null;
  summary: string;
  score?: number;
};

export function upsertSemanticRef(args: {
  appId?: string | null;
  contact?: string | null;
  summary: string;
  refKey?: string;
}): SemanticRef {
  ensureTables();
  const summary = args.summary.trim().slice(0, 500);
  const refKey =
    args.refKey?.trim() ||
    createHash("sha256")
      .update(`${args.appId ?? ""}|${args.contact ?? ""}|${summary}`)
      .digest("hex")
      .slice(0, 40);

  const vec = embedText(
    [summary, args.contact ?? "", args.appId ?? ""].filter(Boolean).join(" "),
  );
  const now = new Date().toISOString();

  getRippleDb()
    .prepare(
      `INSERT INTO semantic_refs (ref_key, app_id, contact, summary, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ref_key) DO UPDATE SET
         app_id = excluded.app_id,
         contact = excluded.contact,
         summary = excluded.summary,
         embedding = excluded.embedding,
         created_at = excluded.created_at`,
    )
    .run(
      refKey,
      args.appId?.slice(0, 120) ?? null,
      args.contact?.trim().toLowerCase().slice(0, 120) ?? null,
      summary,
      embeddingToJson(vec),
      now,
    );

  const row = getRippleDb()
    .prepare(`SELECT id FROM semantic_refs WHERE ref_key = ?`)
    .get(refKey) as { id: number };

  return {
    id: row.id,
    refKey,
    appId: args.appId ?? null,
    contact: args.contact?.trim().toLowerCase() ?? null,
    summary,
  };
}

export function searchPathEmbeddings(
  phrase: string,
  limit = 15,
): Array<{ path: string; score: number }> {
  ensureTables();
  const query = embedText(phrase);
  const rows = getRippleDb()
    .prepare(`SELECT path, embedding FROM semantic_embeddings LIMIT 1200`)
    .all() as Array<{ path: string; embedding: string }>;

  const scored: Array<{ path: string; score: number }> = [];
  for (const row of rows) {
    const vec = embeddingFromJson(row.embedding);
    if (!vec) continue;
    const score = cosineSimilarity(query, vec);
    if (score >= 0.25) scored.push({ path: row.path, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchSemanticRefs(
  phrase: string,
  limit = 10,
): SemanticRef[] {
  ensureTables();
  const query = embedText(phrase);
  const phraseLower = phrase.toLowerCase();
  const rows = getRippleDb()
    .prepare(
      `SELECT id, ref_key, app_id, contact, summary, embedding
       FROM semantic_refs ORDER BY id DESC LIMIT 400`,
    )
    .all() as Array<{
    id: number;
    ref_key: string;
    app_id: string | null;
    contact: string | null;
    summary: string;
    embedding: string;
  }>;

  const scored: SemanticRef[] = [];
  for (const row of rows) {
    const vec = embeddingFromJson(row.embedding);
    if (!vec) continue;
    let score = cosineSimilarity(query, vec);
    const contact = row.contact?.toLowerCase() ?? "";
    const summary = row.summary.toLowerCase();
    if (contact && phraseLower.includes(contact)) score += 0.2;
    if (/\bthat\s+thing\b/i.test(phrase) && summary.includes("shared")) {
      score += 0.08;
    }
    if (score < 0.22) continue;
    scored.push({
      id: row.id,
      refKey: row.ref_key,
      appId: row.app_id,
      contact: row.contact,
      summary: row.summary,
      score,
    });
  }

  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
}

export function clearSemanticEmbeddings(): void {
  ensureTables();
  getRippleDb().exec(`DELETE FROM semantic_embeddings`);
  getRippleDb().exec(`DELETE FROM semantic_refs`);
}
