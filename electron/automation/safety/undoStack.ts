export type UndoAction =
  | { kind: "rename"; from: string; to: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "delete"; path: string; backupPath: string }
  | { kind: "create"; path: string }
  | { kind: "restore_file"; path: string; backupPath: string };

import { getRippleDb } from "../../storage/rippleDb.js";

const MAX_UNDO = 20;

function ensureTable(): void {
  getRippleDb();
}

function trimUndoRows(): void {
  const db = getRippleDb();
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM undo_stack`)
    .get() as { n: number };
  if (count.n <= MAX_UNDO) return;
  db.prepare(
    `DELETE FROM undo_stack WHERE id IN (
      SELECT id FROM undo_stack ORDER BY id ASC LIMIT ?
    )`,
  ).run(count.n - MAX_UNDO);
}

export function pushUndoAction(action: UndoAction): void {
  ensureTable();
  const now = new Date().toISOString();
  getRippleDb()
    .prepare(`INSERT INTO undo_stack (action_json, created_at) VALUES (?, ?)`)
    .run(JSON.stringify(action), now);
  trimUndoRows();
}

export function popUndoAction(): UndoAction | undefined {
  ensureTable();
  const db = getRippleDb();
  const row = db
    .prepare(`SELECT id, action_json FROM undo_stack ORDER BY id DESC LIMIT 1`)
    .get() as { id: number; action_json: string } | undefined;
  if (!row) return undefined;
  db.prepare(`DELETE FROM undo_stack WHERE id = ?`).run(row.id);
  try {
    return JSON.parse(row.action_json) as UndoAction;
  } catch {
    return undefined;
  }
}

export function peekUndoAction(): UndoAction | undefined {
  ensureTable();
  const row = getRippleDb()
    .prepare(`SELECT action_json FROM undo_stack ORDER BY id DESC LIMIT 1`)
    .get() as { action_json: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.action_json) as UndoAction;
  } catch {
    return undefined;
  }
}

export function clearUndoStack(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM undo_stack`);
}

export function undoStackSize(): number {
  ensureTable();
  const row = getRippleDb()
    .prepare(`SELECT COUNT(*) AS n FROM undo_stack`)
    .get() as { n: number };
  return row.n;
}

/** P4.7 — roll back undo entries pushed after a workflow started. */
export async function rollbackUndoTo(
  sizeBefore: number,
  reverse: (action: UndoAction) => Promise<string>,
): Promise<string[]> {
  const results: string[] = [];
  while (undoStackSize() > sizeBefore) {
    const action = popUndoAction();
    if (!action) break;
    try {
      results.push(await reverse(action));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push(`Rollback partial: ${msg}`);
      break;
    }
  }
  return results;
}
