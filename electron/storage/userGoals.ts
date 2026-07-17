import { getRippleDb } from "./rippleDb.js";

export type UserGoals = {
  title: string | null;
  phase: string | null;
  milestone: string | null;
  notes: Record<string, unknown> | null;
  updatedAt: string | null;
};

export function getUserGoals(): UserGoals {
  const row = getRippleDb()
    .prepare(
      `SELECT title, phase, milestone, notes_json, updated_at FROM user_goals WHERE id = 1`,
    )
    .get() as
    | {
        title: string | null;
        phase: string | null;
        milestone: string | null;
        notes_json: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return {
      title: null,
      phase: null,
      milestone: null,
      notes: null,
      updatedAt: null,
    };
  }

  let notes: Record<string, unknown> | null = null;
  if (row.notes_json) {
    try {
      notes = JSON.parse(row.notes_json) as Record<string, unknown>;
    } catch {
      notes = null;
    }
  }

  return {
    title: row.title,
    phase: row.phase,
    milestone: row.milestone,
    notes,
    updatedAt: row.updated_at,
  };
}

export function setUserGoals(input: {
  title?: string;
  phase?: string;
  milestone?: string;
  notes?: Record<string, unknown>;
}): UserGoals {
  const current = getUserGoals();
  const now = new Date().toISOString();
  const next = {
    title: input.title?.trim() ?? current.title,
    phase: input.phase?.trim() ?? current.phase,
    milestone: input.milestone?.trim() ?? current.milestone,
    notes: input.notes ?? current.notes,
    updatedAt: now,
  };

  getRippleDb()
    .prepare(
      `INSERT INTO user_goals (id, title, phase, milestone, notes_json, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         phase = excluded.phase,
         milestone = excluded.milestone,
         notes_json = excluded.notes_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      next.title,
      next.phase,
      next.milestone,
      next.notes ? JSON.stringify(next.notes) : null,
      now,
    );

  return next;
}

export function storeNamedWorkflow(
  name: string,
  steps: unknown[],
): { name: string; steps: unknown[] } {
  const key = name.trim().toLowerCase();
  if (!key) throw new Error("workflow_name_required");
  const now = new Date().toISOString();
  getRippleDb()
    .prepare(
      `INSERT INTO named_workflows (name, steps_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         steps_json = excluded.steps_json,
         updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(steps), now, now);
  return { name: key, steps };
}

export function getNamedWorkflow(name: string): {
  name: string;
  steps: unknown[];
} | null {
  const row = getRippleDb()
    .prepare(`SELECT name, steps_json FROM named_workflows WHERE name = ?`)
    .get(name.trim().toLowerCase()) as
    | { name: string; steps_json: string }
    | undefined;
  if (!row) return null;
  try {
    return {
      name: row.name,
      steps: JSON.parse(row.steps_json) as unknown[],
    };
  } catch {
    return { name: row.name, steps: [] };
  }
}

export function clearUserGoals(): void {
  getRippleDb().prepare(`DELETE FROM user_goals WHERE id = 1`).run();
}

export function clearNamedWorkflows(): void {
  getRippleDb().prepare(`DELETE FROM named_workflows`).run();
}
