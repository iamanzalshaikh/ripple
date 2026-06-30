import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { getRippleDb } from "./rippleDb.js";
import { resolveFolderPath } from "../automation/desktop/openFolder.js";
import { getSearchRootKeys } from "./indexConfig.js";
import { recordFileTouch } from "./recordFileTouch.js";
const MAX_DEPTH = 3;
const MAX_ITEMS_PER_ROOT = 25_000;
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "vendor",
  "__pycache__",
  ".cache",
  ".npm",
  ".yarn",
  "dist",
  "build",
  ".next",
  ".turbo",
  "target",
]);

export type IndexedItem = {
  path: string;
  filename: string;
  extension: string | null;
  isDirectory: boolean;
  rootFolder: string;
  modifiedAt: number;
};

let indexBuildInFlight = false;

function listItemsRecursive(
  dir: string,
  rootFolder: string,
  depth: number,
  out: IndexedItem[],
  rootCount: { n: number },
): void {
  if (depth > MAX_DEPTH || !existsSync(dir) || rootCount.n >= MAX_ITEMS_PER_ROOT) {
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name.startsWith(".") || SKIP_DIR_NAMES.has(name.toLowerCase())) continue;

    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }

    if (st.isFile() || st.isDirectory()) {
      const ext = extname(name).replace(/^\./, "").toLowerCase();
      out.push({
        path: full,
        filename: name,
        extension: ext || null,
        isDirectory: st.isDirectory(),
        rootFolder,
        modifiedAt: Math.floor(st.mtimeMs),
      });
      rootCount.n += 1;
      if (rootCount.n >= MAX_ITEMS_PER_ROOT) return;
    }

    if (st.isDirectory() && depth < MAX_DEPTH) {
      listItemsRecursive(full, rootFolder, depth + 1, out, rootCount);
    }
  }
}

export function getFileIndexCount(): number {
  const row = getRippleDb()
    .prepare("SELECT COUNT(*) AS n FROM file_index")
    .get() as { n: number };
  return row.n ?? 0;
}

/** Full rebuild of Downloads, Documents, Desktop index. */
export function rebuildFileIndex(): number {
  const items: IndexedItem[] = [];
  for (const rootKey of getSearchRootKeys()) {
    const rootCount = { n: 0 };
    listItemsRecursive(resolveFolderPath(rootKey), rootKey, 0, items, rootCount);
    if (rootCount.n >= MAX_ITEMS_PER_ROOT) {
      console.warn(
        `[ripple-desktop] File index cap (${MAX_ITEMS_PER_ROOT}) reached for ${rootKey}`,
      );
    }
  }

  const db = getRippleDb();
  db.prepare("BEGIN").run();
  try {
    db.prepare("DELETE FROM file_index").run();
    const insert = db.prepare(`
      INSERT INTO file_index (path, filename, extension, is_directory, root_folder, modified_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const item of items) {
      insert.run(
        item.path,
        item.filename,
        item.extension,
        item.isDirectory ? 1 : 0,
        item.rootFolder,
        item.modifiedAt,
        now,
      );
    }
    db.prepare("COMMIT").run();
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }

  return items.length;
}

export function startFileIndexBackground(): void {
  if (indexBuildInFlight) return;
  indexBuildInFlight = true;

  setTimeout(() => {
    try {
      const count = rebuildFileIndex();
      console.info(`[ripple-desktop] File index ready (${count} items)`);
    } catch (e: unknown) {
      console.warn(
        "[ripple-desktop] File index build failed:",
        e instanceof Error ? e.message : e,
      );
    } finally {
      indexBuildInFlight = false;
    }
  }, 2500);
}

export function upsertFileIndexPath(path: string): void {
  if (!existsSync(path)) {
    getRippleDb().prepare("DELETE FROM file_index WHERE path = ?").run(path);
    return;
  }

  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }

  if (!st.isFile() && !st.isDirectory()) return;

  const filename = basename(path);
  const ext = extname(filename).replace(/^\./, "").toLowerCase();
  let rootFolder = "desktop";
  const lower = path.toLowerCase();
  if (lower.includes("\\downloads\\") || lower.endsWith("\\downloads")) {
    rootFolder = "downloads";
  } else if (lower.includes("\\documents\\") || lower.endsWith("\\documents")) {
    rootFolder = "documents";
  }

  getRippleDb()
    .prepare(
      `
      INSERT INTO file_index (path, filename, extension, is_directory, root_folder, modified_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        filename = excluded.filename,
        extension = excluded.extension,
        is_directory = excluded.is_directory,
        root_folder = excluded.root_folder,
        modified_at = excluded.modified_at,
        indexed_at = excluded.indexed_at
    `,
    )
    .run(
      path,
      filename,
      ext || null,
      st.isDirectory() ? 1 : 0,
      rootFolder,
      Math.floor(st.mtimeMs),
      new Date().toISOString(),
    );

  try {
    recordFileTouch({ path, source: "file_index", logActivity: false });
  } catch {
    /* semantic touch is best-effort */
  }
}

type IndexRow = {
  path: string;
  filename: string;
  extension: string | null;
  is_directory: number;
  root_folder: string;
  modified_at: number;
};

function rowToPath(row: IndexRow): string {
  return row.path;
}

/** Name token search — exact filename first, then partial. */
export function searchIndexByName(spoken: string, filesOnly = false): string[] {
  const target = spoken.trim().toLowerCase();
  if (!target || getFileIndexCount() === 0) return [];

  const dirFilter = filesOnly ? "AND is_directory = 0" : "";
  const exact = getRippleDb()
    .prepare(
      `SELECT path FROM file_index WHERE lower(filename) = ? ${dirFilter} ORDER BY modified_at DESC LIMIT 20`,
    )
    .all(target) as { path: string }[];

  if (exact.length > 0) {
    return exact.map((r) => r.path);
  }

  const partial = getRippleDb()
    .prepare(
      `SELECT path FROM file_index WHERE lower(filename) LIKE ? ${dirFilter} ORDER BY modified_at DESC LIMIT 20`,
    )
    .all(`%${target}%`) as { path: string }[];

  return partial.map((r) => r.path);
}

/** Newest file in Downloads (any depth in index). */
export function queryLastDownloadedFile(): string[] {
  if (getFileIndexCount() === 0) return [];

  const rows = getRippleDb()
    .prepare(
      `SELECT path FROM file_index
       WHERE root_folder = 'downloads' AND is_directory = 0
       ORDER BY modified_at DESC LIMIT 5`,
    )
    .all() as IndexRow[];

  return rows.map(rowToPath);
}

/** Newest file whose name contains token (e.g. invoice, resume). */
export function queryLatestByNameToken(token: string, filesOnly = true): string[] {
  const t = token.trim().toLowerCase();
  if (!t || getFileIndexCount() === 0) return [];

  const dirFilter = filesOnly ? "AND is_directory = 0" : "";
  const rows = getRippleDb()
    .prepare(
      `SELECT path FROM file_index
       WHERE lower(filename) LIKE ? ${dirFilter}
       ORDER BY modified_at DESC LIMIT 10`,
    )
    .all(`%${t}%`) as IndexRow[];

  return rows.map(rowToPath);
}

/** Files modified on a calendar day (local time). */
export function queryModifiedOnDay(
  dayStartMs: number,
  dayEndMs: number,
  extension?: string,
): string[] {
  if (getFileIndexCount() === 0) return [];

  const ext = extension?.trim().toLowerCase();
  const rows = ext
    ? (getRippleDb()
        .prepare(
          `SELECT path FROM file_index
           WHERE is_directory = 0 AND modified_at >= ? AND modified_at < ? AND lower(extension) = ?
           ORDER BY modified_at DESC LIMIT 10`,
        )
        .all(dayStartMs, dayEndMs, ext) as IndexRow[])
    : (getRippleDb()
        .prepare(
          `SELECT path FROM file_index
           WHERE is_directory = 0 AND modified_at >= ? AND modified_at < ?
           ORDER BY modified_at DESC LIMIT 10`,
        )
        .all(dayStartMs, dayEndMs) as IndexRow[]);

  return rows.map(rowToPath);
}

/** Files modified within a time window — optional token/extension filter (P5.3). */
export function queryModifiedInRange(
  startMs: number,
  endMs: number,
  opts?: { token?: string; extension?: string },
): string[] {
  if (getFileIndexCount() === 0) return [];

  const token = opts?.token?.trim().toLowerCase();
  const ext = opts?.extension?.trim().toLowerCase();

  let sql = `SELECT path FROM file_index
    WHERE is_directory = 0 AND modified_at >= ? AND modified_at < ?`;
  const params: (string | number)[] = [startMs, endMs];

  if (ext) {
    sql += ` AND lower(extension) = ?`;
    params.push(ext);
  }
  if (token) {
    sql += ` AND lower(filename) LIKE ?`;
    params.push(`%${token}%`);
  }

  sql += ` ORDER BY modified_at DESC LIMIT 15`;

  const rows = getRippleDb().prepare(sql).all(...params) as IndexRow[];
  return rows.map(rowToPath);
}

/** Newest files by extension (e.g. all PDFs by modified_at). */
export function queryLatestByExtension(
  extension: string,
  limit = 20,
): string[] {
  if (getFileIndexCount() === 0) return [];

  const ext = extension.trim().toLowerCase();
  const rows = getRippleDb()
    .prepare(
      `SELECT path FROM file_index
       WHERE is_directory = 0 AND lower(extension) = ?
       ORDER BY modified_at DESC LIMIT ?`,
    )
    .all(ext, limit) as IndexRow[];

  return rows.map(rowToPath);
}
