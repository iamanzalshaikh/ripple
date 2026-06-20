import { basename } from "node:path";
import { getRippleDb } from "./rippleDb.js";

export type ActivityLogEntry = {
  id: number;
  path: string | null;
  app_id: string | null;
  contact: string | null;
  command: string;
  summary: string | null;
  created_at: string;
};

function ensureTable(): void {
  getRippleDb();
}

export function appendActivityLog(entry: {
  path?: string | null;
  app_id?: string | null;
  contact?: string | null;
  command: string;
  summary?: string | null;
}): void {
  ensureTable();
  const now = new Date().toISOString();
  getRippleDb()
    .prepare(
      `INSERT INTO activity_log (path, app_id, contact, command, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.path?.slice(0, 2000) ?? null,
      entry.app_id?.slice(0, 120) ?? null,
      entry.contact?.slice(0, 120) ?? null,
      entry.command.slice(0, 2000),
      entry.summary?.slice(0, 500) ?? null,
      now,
    );
}

/** P8 — paths tied to a person or vague topic from past commands. */
export function searchActivityByPhrase(phrase: string, limit = 12): string[] {
  ensureTable();
  const needle = phrase.trim().toLowerCase();
  if (!needle) return [];

  const contactMatch = needle.match(
    /\b(?:with|from|to|by)\s+([a-z][a-z0-9_-]{1,30})\b/i,
  );
  const contact = contactMatch?.[1]?.toLowerCase() ?? "";

  const rows = getRippleDb()
    .prepare(
      `SELECT path, contact, command, summary, created_at
       FROM activity_log
       WHERE path IS NOT NULL
         AND (
           command LIKE '%' || ? || '%'
           OR summary LIKE '%' || ? || '%'
           OR (? != '' AND contact LIKE '%' || ? || '%')
         )
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(needle, needle, contact, contact, limit) as Array<{
    path: string;
  }>;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const key = row.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.path);
  }
  return out;
}

export function listRecentActivity(limit = 50): ActivityLogEntry[] {
  ensureTable();
  return getRippleDb()
    .prepare(
      `SELECT id, path, app_id, contact, command, summary, created_at
       FROM activity_log ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as ActivityLogEntry[];
}

export function summarizeActivity(path: string, command: string): string {
  const name = basename(path);
  return `${name} — ${command.slice(0, 80)}`;
}

export function clearActivityLog(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM activity_log`);
}
