import { existsSync } from "node:fs";
import { getRippleDb } from "./rippleDb.js";
import { recencyScore } from "./graphScoring.js";

export type CapabilityCacheEntry = {
  phrase: string;
  entity: string;
  confidence: number;
  resolved_at: number;
};

const CACHE_MIN_CONFIDENCE = 0.75;

function keyFor(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

function ensureTable(): void {
  getRippleDb();
}

export function getCapabilityCacheHit(phrase: string): CapabilityCacheEntry | null {
  ensureTable();
  const key = keyFor(phrase);
  const row = getRippleDb()
    .prepare(
      `SELECT phrase, entity_path, confidence, resolved_at
       FROM capability_cache WHERE phrase_key = ?`,
    )
    .get(key) as
    | {
        phrase: string;
        entity_path: string;
        confidence: number;
        resolved_at: string;
      }
    | undefined;

  if (!row) return null;

  const entry: CapabilityCacheEntry = {
    phrase: row.phrase,
    entity: row.entity_path,
    confidence: row.confidence,
    resolved_at: Date.parse(row.resolved_at) || Date.now(),
  };

  if (!existsSync(entry.entity)) {
    getRippleDb()
      .prepare(`DELETE FROM capability_cache WHERE phrase_key = ?`)
      .run(key);
    return null;
  }

  const ageDecay = recencyScore(entry.resolved_at);
  const effectiveConfidence = entry.confidence * (0.5 + 0.5 * ageDecay);
  if (effectiveConfidence < CACHE_MIN_CONFIDENCE) {
    getRippleDb()
      .prepare(`DELETE FROM capability_cache WHERE phrase_key = ?`)
      .run(key);
    return null;
  }

  return { ...entry, confidence: effectiveConfidence };
}

export function setCapabilityCacheEntry(
  phrase: string,
  entity: string,
  confidence: number,
): void {
  ensureTable();
  const key = keyFor(phrase);
  const now = new Date().toISOString();
  getRippleDb()
    .prepare(
      `INSERT INTO capability_cache (phrase_key, phrase, entity_path, confidence, resolved_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(phrase_key) DO UPDATE SET
         phrase = excluded.phrase,
         entity_path = excluded.entity_path,
         confidence = excluded.confidence,
         resolved_at = excluded.resolved_at`,
    )
    .run(key, phrase.trim(), entity, confidence, now);
}

export function clearCapabilityCache(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM capability_cache`);
}
