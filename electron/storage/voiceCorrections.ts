import { getRippleDb } from "./rippleDb.js";
import { addAlias } from "../automation/desktop/aliasRegistry.js";

export type VoiceCorrection = {
  spokenForm: string;
  canonicalForm: string;
  source: string;
  updatedAt: string;
};

function normalizeSpoken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function learnCorrection(input: {
  spokenForm: string;
  canonicalForm: string;
  source?: string;
  /** When canonical looks like a path, also save as folder alias. */
  asAliasPath?: string;
}): VoiceCorrection {
  const spoken = normalizeSpoken(input.spokenForm);
  const canonical = input.canonicalForm.trim();
  if (!spoken || !canonical) {
    throw new Error("correction_requires_spoken_and_canonical");
  }
  const source = input.source?.trim() || "voice";
  const updatedAt = new Date().toISOString();

  getRippleDb()
    .prepare(
      `INSERT INTO voice_corrections (spoken_form, canonical_form, source, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(spoken_form) DO UPDATE SET
         canonical_form = excluded.canonical_form,
         source = excluded.source,
         updated_at = excluded.updated_at`,
    )
    .run(spoken, canonical, source, updatedAt);

  if (input.asAliasPath?.trim()) {
    try {
      addAlias(spoken, input.asAliasPath.trim(), "project");
    } catch {
      /* alias optional */
    }
  } else if (/^[A-Za-z]:[\\/]/.test(canonical) || canonical.includes("\\")) {
    try {
      addAlias(spoken, canonical, "project");
    } catch {
      /* optional */
    }
  }

  return {
    spokenForm: spoken,
    canonicalForm: canonical,
    source,
    updatedAt,
  };
}

export function resolveCorrection(spoken: string): string | null {
  const key = normalizeSpoken(spoken);
  if (!key) return null;
  const row = getRippleDb()
    .prepare(
      `SELECT canonical_form FROM voice_corrections WHERE spoken_form = ?`,
    )
    .get(key) as { canonical_form: string } | undefined;
  return row?.canonical_form ?? null;
}

export function listCorrections(limit = 50): VoiceCorrection[] {
  const rows = getRippleDb()
    .prepare(
      `SELECT spoken_form, canonical_form, source, updated_at
       FROM voice_corrections
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    spoken_form: string;
    canonical_form: string;
    source: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    spokenForm: r.spoken_form,
    canonicalForm: r.canonical_form,
    source: r.source,
    updatedAt: r.updated_at,
  }));
}

export function clearCorrections(): void {
  getRippleDb().prepare(`DELETE FROM voice_corrections`).run();
}

/** Apply longest correction match inside an utterance. */
export function applyCorrectionsToUtterance(text: string): string {
  let out = text;
  const rows = listCorrections(100).sort(
    (a, b) => b.spokenForm.length - a.spokenForm.length,
  );
  for (const row of rows) {
    const re = new RegExp(
      `\\b${row.spokenForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    out = out.replace(re, row.canonicalForm);
  }
  return out;
}
