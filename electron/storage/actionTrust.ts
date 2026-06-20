import { getRippleDb } from "./rippleDb.js";

const AUTO_EXECUTE_THRESHOLD = 8;

function ensureTable(): void {
  getRippleDb().exec(`
    CREATE TABLE IF NOT EXISTS action_trust (
      phrase_key TEXT PRIMARY KEY NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);
}

function keyFor(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

const SIGNAL_DELTA: Record<string, number> = {
  success: 1,
  clarify: 0.5,
  undo: -2,
  cancel: -1,
};

export function recordTrustSignal(
  phrase: string,
  signal: keyof typeof SIGNAL_DELTA,
): void {
  ensureTable();
  const key = keyFor(phrase);
  if (!key) return;

  const row = getRippleDb()
    .prepare(`SELECT score FROM action_trust WHERE phrase_key = ?`)
    .get(key) as { score: number } | undefined;

  const next = (row?.score ?? 0) + (SIGNAL_DELTA[signal] ?? 0);
  const now = new Date().toISOString();

  getRippleDb()
    .prepare(
      `INSERT INTO action_trust (phrase_key, score, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(phrase_key) DO UPDATE SET
         score = excluded.score,
         updated_at = excluded.updated_at`,
    )
    .run(key, next, now);
}

export function getTrustScore(phrase: string): number {
  ensureTable();
  const row = getRippleDb()
    .prepare(`SELECT score FROM action_trust WHERE phrase_key = ?`)
    .get(keyFor(phrase)) as { score: number } | undefined;
  return row?.score ?? 0;
}

export function shouldAutoExecute(phrase: string, confidence: number): boolean {
  return confidence >= 0.9 && getTrustScore(phrase) >= AUTO_EXECUTE_THRESHOLD;
}
