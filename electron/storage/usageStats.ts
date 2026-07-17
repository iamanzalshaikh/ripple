import { getRippleDb } from "./rippleDb.js";

export type UsageKind = "app" | "path" | "workflow";

export type UsageRow = {
  kind: UsageKind;
  key: string;
  count: number;
  lastUsedAt: string;
};

export function recordUsage(kind: UsageKind, key: string): UsageRow {
  const k = key.trim().toLowerCase();
  if (!k) throw new Error("usage_key_required");
  const now = new Date().toISOString();
  const db = getRippleDb();
  db.prepare(
    `INSERT INTO usage_counts (kind, key, count, last_used_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(kind, key) DO UPDATE SET
       count = count + 1,
       last_used_at = excluded.last_used_at`,
  ).run(kind, k, now);

  const row = db
    .prepare(
      `SELECT kind, key, count, last_used_at FROM usage_counts WHERE kind = ? AND key = ?`,
    )
    .get(kind, k) as {
    kind: UsageKind;
    key: string;
    count: number;
    last_used_at: string;
  };

  return {
    kind: row.kind,
    key: row.key,
    count: row.count,
    lastUsedAt: row.last_used_at,
  };
}

/** Rank candidate keys by usage; unknown keys get count 0 and keep input order after known. */
export function rankChoices(
  kind: UsageKind,
  candidates: string[],
): Array<{ key: string; count: number; rank: number }> {
  const unique = [
    ...new Set(candidates.map((c) => c.trim()).filter(Boolean)),
  ];
  const db = getRippleDb();
  const scored = unique.map((key) => {
    const row = db
      .prepare(
        `SELECT count FROM usage_counts WHERE kind = ? AND key = ?`,
      )
      .get(kind, key.toLowerCase()) as { count: number } | undefined;
    return { key, count: row?.count ?? 0 };
  });
  scored.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

export function clearUsageCounts(): void {
  getRippleDb().prepare(`DELETE FROM usage_counts`).run();
}
