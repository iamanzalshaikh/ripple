import { basename } from "node:path";
import { getRippleDb } from "./rippleDb.js";
import { getMemory, setMemory } from "./sessionMemory.js";

export type ActiveWorkspace = {
  name: string;
  path: string;
  goal: string | null;
  setAt: string;
};

export type RecentContextEntry = {
  projectPath: string | null;
  filePath: string | null;
  diagnosticCode: string | null;
  command: string | null;
  createdAt: string;
};

const RECENT_LIMIT = 30;

export function getActiveWorkspace(): ActiveWorkspace | null {
  const db = getRippleDb();
  const row = db
    .prepare(
      `SELECT name, path, goal, set_at FROM active_workspace WHERE id = 1`,
    )
    .get() as
    | { name: string; path: string; goal: string | null; set_at: string }
    | undefined;
  if (!row) return null;
  return {
    name: row.name,
    path: row.path,
    goal: row.goal,
    setAt: row.set_at,
  };
}

export function setActiveWorkspace(input: {
  path: string;
  name?: string;
  goal?: string;
}): ActiveWorkspace {
  const path = input.path.trim();
  if (!path) throw new Error("workspace_path_required");
  const name = (input.name?.trim() || basename(path) || path).trim();
  const goal = input.goal?.trim() || null;
  const setAt = new Date().toISOString();

  const db = getRippleDb();
  db.prepare(
    `INSERT INTO active_workspace (id, name, path, goal, set_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       path = excluded.path,
       goal = excluded.goal,
       set_at = excluded.set_at`,
  ).run(name, path, goal, setAt);

  setMemory("last_project", path);
  setMemory("last_workspace", path);
  setMemory("last_opened_path", path);
  setMemory("last_opened_kind", "project");

  return { name, path, goal, setAt };
}

export function clearActiveWorkspace(): void {
  getRippleDb().prepare(`DELETE FROM active_workspace WHERE id = 1`).run();
}

export function pushRecentContext(input: {
  projectPath?: string;
  filePath?: string;
  diagnosticCode?: string;
  command?: string;
}): void {
  const db = getRippleDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO recent_context (project_path, file_path, diagnostic_code, command, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    input.projectPath?.trim() || null,
    input.filePath?.trim() || null,
    input.diagnosticCode?.trim() || null,
    input.command?.trim() || null,
    now,
  );

  // Keep rolling window.
  db.prepare(
    `DELETE FROM recent_context WHERE id NOT IN (
       SELECT id FROM recent_context ORDER BY created_at DESC LIMIT ?
     )`,
  ).run(RECENT_LIMIT);

  if (input.projectPath?.trim()) {
    setMemory("last_project", input.projectPath.trim());
  }
  if (input.filePath?.trim()) {
    setMemory("last_file", input.filePath.trim());
  }
}

export function getRecentContext(limit = 10): RecentContextEntry[] {
  const db = getRippleDb();
  const rows = db
    .prepare(
      `SELECT project_path, file_path, diagnostic_code, command, created_at
       FROM recent_context
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(limit, RECENT_LIMIT))) as Array<{
    project_path: string | null;
    file_path: string | null;
    diagnostic_code: string | null;
    command: string | null;
    created_at: string;
  }>;

  if (rows.length > 0) {
    return rows.map((r) => ({
      projectPath: r.project_path,
      filePath: r.file_path,
      diagnosticCode: r.diagnostic_code,
      command: r.command,
      createdAt: r.created_at,
    }));
  }

  // Seed from session memory when table empty.
  const lastProject = getMemory("last_project");
  const lastFile = getMemory("last_file");
  if (!lastProject && !lastFile) return [];
  return [
    {
      projectPath: lastProject,
      filePath: lastFile,
      diagnosticCode: null,
      command: null,
      createdAt: new Date().toISOString(),
    },
  ];
}

export function getLastProjectPath(): string | null {
  return getActiveWorkspace()?.path ?? getMemory("last_project");
}

export function clearRecentContext(): void {
  getRippleDb().prepare(`DELETE FROM recent_context`).run();
}
