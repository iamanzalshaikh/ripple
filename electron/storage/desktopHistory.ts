import { getRippleDb } from "./rippleDb.js";

export interface DesktopHistoryRow {
  id: number;
  command: string;
  intent: string | null;
  resolved_path: string | null;
  entities_json: string | null;
  result: string | null;
  status: string;
  created_at: string;
}

export function appendDesktopHistory(entry: {
  command: string;
  intent?: string | null;
  resolved_path?: string | null;
  entities_json?: string | null;
  result?: string | null;
  status: "ok" | "error";
}): void {
  const db = getRippleDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO desktop_history (command, intent, resolved_path, entities_json, result, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.command.slice(0, 2000),
    entry.intent ?? null,
    entry.resolved_path?.slice(0, 2000) ?? null,
    entry.entities_json?.slice(0, 4000) ?? null,
    entry.result?.slice(0, 4000) ?? null,
    entry.status,
    now,
  );
}

export function listDesktopHistory(limit = 50): DesktopHistoryRow[] {
  const db = getRippleDb();
  return db
    .prepare(
      `SELECT id, command, intent, resolved_path, entities_json, result, status, created_at
       FROM desktop_history
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as DesktopHistoryRow[];
}

/** Most recent successful open with a resolved path — recall fallback. */
export function getLastSuccessfulOpen(): DesktopHistoryRow | null {
  const db = getRippleDb();
  const row = db
    .prepare(
      `SELECT id, command, intent, resolved_path, entities_json, result, status, created_at
       FROM desktop_history
       WHERE status = 'ok' AND resolved_path IS NOT NULL AND resolved_path != ''
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get() as DesktopHistoryRow | undefined;
  return row ?? null;
}

/** Replay last successful command with same intent family. */
export function getLastSuccessfulByIntent(intentPrefix: string): DesktopHistoryRow | null {
  const db = getRippleDb();
  const row = db
    .prepare(
      `SELECT id, command, intent, resolved_path, entities_json, result, status, created_at
       FROM desktop_history
       WHERE status = 'ok' AND intent LIKE ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(`${intentPrefix}%`) as DesktopHistoryRow | undefined;
  return row ?? null;
}

