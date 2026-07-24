import { getRippleDb } from "./rippleDb.js";

export type StyleTone = "professional" | "casual" | "neutral";

export type StyleProfile = {
  processName: string;
  tone: StyleTone;
  updatedAt: string;
};

function normalizeProcessName(value: string): string {
  return value.trim().toLowerCase();
}

const VALID_TONES = new Set<StyleTone>(["professional", "casual", "neutral"]);

export function setStyleProfile(input: {
  processName: string;
  tone: StyleTone;
}): StyleProfile {
  const processName = normalizeProcessName(input.processName);
  if (!processName) {
    throw new Error("style_profile_requires_process_name");
  }
  if (!VALID_TONES.has(input.tone)) {
    throw new Error(`invalid_tone:${input.tone}`);
  }
  const updatedAt = new Date().toISOString();

  if (input.tone === "neutral") {
    // Neutral = no override; storing a row for it is pointless churn.
    getRippleDb()
      .prepare(`DELETE FROM style_profiles WHERE process_name = ?`)
      .run(processName);
    return { processName, tone: "neutral", updatedAt };
  }

  getRippleDb()
    .prepare(
      `INSERT INTO style_profiles (process_name, tone, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(process_name) DO UPDATE SET
         tone = excluded.tone,
         updated_at = excluded.updated_at`,
    )
    .run(processName, input.tone, updatedAt);

  return { processName, tone: input.tone, updatedAt };
}

export function removeStyleProfile(processName: string): boolean {
  const key = normalizeProcessName(processName);
  if (!key) return false;
  const result = getRippleDb()
    .prepare(`DELETE FROM style_profiles WHERE process_name = ?`)
    .run(key);
  return (result.changes ?? 0) > 0;
}

export function listStyleProfiles(): StyleProfile[] {
  const rows = getRippleDb()
    .prepare(
      `SELECT process_name, tone, updated_at FROM style_profiles ORDER BY process_name ASC`,
    )
    .all() as Array<{ process_name: string; tone: string; updated_at: string }>;

  return rows.map((r) => ({
    processName: r.process_name,
    tone: r.tone as StyleTone,
    updatedAt: r.updated_at,
  }));
}

/** Wispr Styles = English + desktop first (per plan) — one tone per foreground process. */
export function getStyleProfileForProcess(processName?: string | null): StyleTone {
  const key = normalizeProcessName(processName ?? "");
  if (!key) return "neutral";
  const row = getRippleDb()
    .prepare(`SELECT tone FROM style_profiles WHERE process_name = ?`)
    .get(key) as { tone: string } | undefined;
  return (row?.tone as StyleTone | undefined) ?? "neutral";
}
