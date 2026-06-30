import { getRippleDb } from "./rippleDb.js";

export type MemoryKey =
  | "last_file"
  | "last_pdf"
  | "last_video"
  | "last_image"
  | "last_folder"
  | "last_project"
  | "last_contact"
  | "last_app"
  | "last_workspace"
  | "last_opened_path"
  | "last_opened_kind"
  | "last_parent_folder"
  | "last_prior_opened_path"
  | "last_web_surface"
  | "last_web_surface_at"
  | "last_viewed_pdf"
  | "last_viewed_pdf_title"
  | "last_viewed_pdf_at"
  | "last_viewed_video"
  | "last_viewed_video_title"
  | "last_viewed_video_at"
  | "last_viewed_image"
  | "last_viewed_image_title"
  | "last_viewed_image_at";

export type LastOpenedKind =
  | "file"
  | "folder"
  | "project"
  | "workspace"
  | "app";

export function setMemory(key: MemoryKey, value: string): void {
  const db = getRippleDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memory (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, now);
}

export function getMemory(key: MemoryKey): string | null {
  const db = getRippleDb();
  const row = db
    .prepare(`SELECT value FROM memory WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function clearMemory(key: MemoryKey): void {
  const db = getRippleDb();
  db.prepare(`DELETE FROM memory WHERE key = ?`).run(key);
}
