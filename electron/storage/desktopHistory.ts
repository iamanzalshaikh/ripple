import { getRippleDb } from "./rippleDb.js";

export interface DesktopHistoryRow {
  id: number;
  command: string;
  intent: string | null;
  result: string | null;
  status: string;
  created_at: string;
}

export function appendDesktopHistory(entry: {
  command: string;
  intent?: string | null;
  result?: string | null;
  status: "ok" | "error";
}): void {
  const db = getRippleDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO desktop_history (command, intent, result, status, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    entry.command.slice(0, 2000),
    entry.intent ?? null,
    entry.result?.slice(0, 4000) ?? null,
    entry.status,
    now,
  );
}

export function listDesktopHistory(limit = 50): DesktopHistoryRow[] {
  const db = getRippleDb();
  return db
    .prepare(
      `SELECT id, command, intent, result, status, created_at
       FROM desktop_history
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as DesktopHistoryRow[];
}
