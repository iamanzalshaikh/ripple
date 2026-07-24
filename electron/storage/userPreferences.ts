import { getRippleDb } from "./rippleDb.js";

export type UserPreferences = {
  preferredIde: string | null;
  preferredTerminal: string | null;
  preferredBrowser: string | null;
  defaultProjectsRoot: string | null;
  confirmStrictness: string | null;
  language: string | null;
  /** P9.6 — "1" when quiet/whisper dictation mode is enabled, else null/"0". */
  quietMode: string | null;
  updatedAt: string | null;
};

const EMPTY: UserPreferences = {
  preferredIde: null,
  preferredTerminal: null,
  preferredBrowser: null,
  defaultProjectsRoot: null,
  confirmStrictness: null,
  language: null,
  quietMode: null,
  updatedAt: null,
};

export type PreferenceKey =
  | "preferred_ide"
  | "preferred_terminal"
  | "preferred_browser"
  | "default_projects_root"
  | "confirm_strictness"
  | "language"
  | "quiet_mode";

const KEY_TO_COLUMN: Record<PreferenceKey, keyof UserPreferences> = {
  preferred_ide: "preferredIde",
  preferred_terminal: "preferredTerminal",
  preferred_browser: "preferredBrowser",
  default_projects_root: "defaultProjectsRoot",
  confirm_strictness: "confirmStrictness",
  language: "language",
  quiet_mode: "quietMode",
};

export function getUserPreferences(): UserPreferences {
  const db = getRippleDb();
  const row = db
    .prepare(
      `SELECT preferred_ide, preferred_terminal, preferred_browser,
              default_projects_root, confirm_strictness, language, quiet_mode, updated_at
       FROM user_preferences WHERE id = 1`,
    )
    .get() as
    | {
        preferred_ide: string | null;
        preferred_terminal: string | null;
        preferred_browser: string | null;
        default_projects_root: string | null;
        confirm_strictness: string | null;
        language: string | null;
        quiet_mode: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) return { ...EMPTY };

  return {
    preferredIde: row.preferred_ide,
    preferredTerminal: row.preferred_terminal,
    preferredBrowser: row.preferred_browser,
    defaultProjectsRoot: row.default_projects_root,
    confirmStrictness: row.confirm_strictness,
    language: row.language,
    quietMode: row.quiet_mode,
    updatedAt: row.updated_at,
  };
}

export function updateUserPreference(
  key: PreferenceKey,
  value: string,
): UserPreferences {
  const col = KEY_TO_COLUMN[key];
  if (!col) throw new Error(`unknown_preference:${key}`);

  const db = getRippleDb();
  const now = new Date().toISOString();
  const current = getUserPreferences();
  const next: UserPreferences = {
    ...current,
    [col]: value.trim() || null,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO user_preferences (
       id, preferred_ide, preferred_terminal, preferred_browser,
       default_projects_root, confirm_strictness, language, quiet_mode, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       preferred_ide = excluded.preferred_ide,
       preferred_terminal = excluded.preferred_terminal,
       preferred_browser = excluded.preferred_browser,
       default_projects_root = excluded.default_projects_root,
       confirm_strictness = excluded.confirm_strictness,
       language = excluded.language,
       quiet_mode = excluded.quiet_mode,
       updated_at = excluded.updated_at`,
  ).run(
    next.preferredIde,
    next.preferredTerminal,
    next.preferredBrowser,
    next.defaultProjectsRoot,
    next.confirmStrictness,
    next.language,
    next.quietMode,
    now,
  );

  return next;
}

export function clearUserPreferences(): void {
  getRippleDb().prepare(`DELETE FROM user_preferences WHERE id = 1`).run();
}
