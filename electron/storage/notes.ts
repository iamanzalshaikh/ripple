import { randomUUID } from "node:crypto";
import { getRippleDb } from "./rippleDb.js";

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export function createNote(input: { title?: string; body?: string }): Note {
  const id = randomUUID();
  const now = new Date().toISOString();
  const title = input.title?.trim() || "Untitled note";
  const body = input.body ?? "";

  getRippleDb()
    .prepare(
      `INSERT INTO notes (id, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, title, body, now, now);

  return { id, title, body, createdAt: now, updatedAt: now };
}

export function updateNote(
  id: string,
  changes: { title?: string; body?: string },
): Note | null {
  const existing = getNote(id);
  if (!existing) return null;

  const title = changes.title !== undefined ? changes.title.trim() || "Untitled note" : existing.title;
  const body = changes.body !== undefined ? changes.body : existing.body;
  const updatedAt = new Date().toISOString();

  getRippleDb()
    .prepare(`UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?`)
    .run(title, body, updatedAt, id);

  return { ...existing, title, body, updatedAt };
}

export function deleteNote(id: string): boolean {
  const result = getRippleDb().prepare(`DELETE FROM notes WHERE id = ?`).run(id);
  return (result.changes ?? 0) > 0;
}

export function getNote(id: string): Note | null {
  const row = getRippleDb()
    .prepare(`SELECT id, title, body, created_at, updated_at FROM notes WHERE id = ?`)
    .get(id) as
    | { id: string; title: string; body: string; created_at: string; updated_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNotes(limit = 200): Note[] {
  const rows = getRippleDb()
    .prepare(
      `SELECT id, title, body, created_at, updated_at
       FROM notes ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    title: string;
    body: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Upsert by id — used when applying a pulled sync item (id is cloud-authoritative there). */
export function upsertNoteFromSync(note: {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}): void {
  getRippleDb()
    .prepare(
      `INSERT INTO notes (id, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         updated_at = excluded.updated_at`,
    )
    .run(note.id, note.title, note.body, note.createdAt, note.updatedAt);
}
