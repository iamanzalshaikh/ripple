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

/** Phase 7.4 — Dictionary UI manual delete of a single entry. */
export function removeCorrection(spokenForm: string): boolean {
  const key = normalizeSpoken(spokenForm);
  if (!key) return false;
  const result = getRippleDb()
    .prepare(`DELETE FROM voice_corrections WHERE spoken_form = ?`)
    .run(key);
  return (result.changes ?? 0) > 0;
}

/**
 * Max dictionary entries considered when correcting an utterance. The old
 * hard-coded 100 silently dropped a user's least-recently-updated entries:
 * they still showed in the dictionary UI but stopped firing.
 */
const MAX_APPLIED_CORRECTIONS = 2000;

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Unicode-aware word boundary. JS `\b` is ASCII-only, so `\bjosé\b` never
 * matched "josé" (é counts as a non-word char) — every non-ASCII dictionary
 * entry was silently dead.
 */
function buildRuleRegex(spokenForm: string): RegExp {
  const body = spokenForm.replace(REGEX_SPECIALS, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "giu");
}

/** Apply longest correction match inside an utterance. */
export function applyCorrectionsToUtterance(text: string): string {
  if (!text) return text;

  const rows = listCorrections(MAX_APPLIED_CORRECTIONS).sort(
    (a, b) => b.spokenForm.length - a.spokenForm.length,
  );
  if (!rows.length) return text;

  // Match every rule against the ORIGINAL text and splice once at the end.
  // Replacing sequentially let a later rule re-correct an earlier rule's
  // output: "ana maria"→"Ana-María" then rule "ana" hit the "Ana" inside it
  // and produced "Anna-María".
  type Hit = { start: number; end: number; replacement: string };
  const hits: Hit[] = [];
  const claimed = new Array<boolean>(text.length).fill(false);

  for (const row of rows) {
    const re = buildRuleRegex(row.spokenForm);
    let match: RegExpExecArray | null = re.exec(text);
    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) {
        re.lastIndex = start + 1;
        match = re.exec(text);
        continue;
      }
      let overlaps = false;
      for (let i = start; i < end; i += 1) {
        if (claimed[i]) {
          overlaps = true;
          break;
        }
      }
      // Longest rules run first, so an overlap means a better rule owns this span.
      if (!overlaps) {
        for (let i = start; i < end; i += 1) claimed[i] = true;
        hits.push({ start, end, replacement: row.canonicalForm });
      }
      match = re.exec(text);
    }
  }

  if (!hits.length) return text;

  hits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const hit of hits) {
    out += text.slice(cursor, hit.start) + hit.replacement;
    cursor = hit.end;
  }
  return out + text.slice(cursor);
}
