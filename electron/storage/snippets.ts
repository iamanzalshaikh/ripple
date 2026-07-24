import { getRippleDb } from "./rippleDb.js";

export type Snippet = {
  trigger: string;
  expansion: string;
  createdAt: string;
  updatedAt: string;
};

/** Strip quotes / trailing sentence punct so STT "sig." still matches "sig". */
function stripUtteranceNoise(value: string): string {
  return value
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[.!?…。]+$/g, "")
    .trim();
}

/**
 * Leading discourse fillers STT often prepends ("Ah, intro" → "intro").
 * Only applied as an alternate match key — never mutates stored triggers.
 */
function stripLeadingFiller(value: string): string {
  return value
    .replace(/^(?:ah|oh|um+|uh+|erm+|well|okay|ok)[,.\s]+/i, "")
    .trim();
}

export function normalizeTrigger(value: string): string {
  return stripUtteranceNoise(value).toLowerCase().replace(/\s+/g, " ");
}

/** Candidate lookup keys for a spoken utterance (exact + punct/filler variants). */
export function snippetLookupKeys(utterance: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const key = normalizeTrigger(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  push(utterance);
  push(stripLeadingFiller(utterance));
  push(stripLeadingFiller(stripUtteranceNoise(utterance)));
  return keys;
}

export function learnSnippet(input: {
  trigger: string;
  expansion: string;
}): Snippet {
  const trigger = normalizeTrigger(input.trigger);
  const expansion = input.expansion.trim();
  if (!trigger || !expansion) {
    throw new Error("snippet_requires_trigger_and_expansion");
  }
  const now = new Date().toISOString();
  const existing = getRippleDb()
    .prepare(`SELECT created_at FROM snippets WHERE trigger = ?`)
    .get(trigger) as { created_at: string } | undefined;
  const createdAt = existing?.created_at ?? now;

  getRippleDb()
    .prepare(
      `INSERT INTO snippets (trigger, expansion, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(trigger) DO UPDATE SET
         expansion = excluded.expansion,
         updated_at = excluded.updated_at`,
    )
    .run(trigger, expansion, createdAt, now);

  return { trigger, expansion, createdAt, updatedAt: now };
}

export function removeSnippet(trigger: string): boolean {
  const key = normalizeTrigger(trigger);
  if (!key) return false;
  const result = getRippleDb()
    .prepare(`DELETE FROM snippets WHERE trigger = ?`)
    .run(key);
  return (result.changes ?? 0) > 0;
}

export function listSnippets(limit = 100): Snippet[] {
  const rows = getRippleDb()
    .prepare(
      `SELECT trigger, expansion, created_at, updated_at
       FROM snippets
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    trigger: string;
    expansion: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    trigger: r.trigger,
    expansion: r.expansion,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function countSnippets(): number {
  const row = getRippleDb()
    .prepare(`SELECT COUNT(*) AS n FROM snippets`)
    .get() as { n: number };
  return Number(row?.n ?? 0);
}

/**
 * Voice-trigger match (Phase 7.2b) — an utterance that IS a snippet trigger
 * (whole phrase, case/space/punct-insensitive) expands verbatim. A snippet is a
 * precise, user-authored expansion, not prose to "clean up" — callers should
 * use the expansion directly and skip the AI cleanup pass entirely.
 */
export function resolveSnippetTrigger(utterance: string): string | null {
  const keys = snippetLookupKeys(utterance);
  if (keys.length === 0) return null;

  const stmt = getRippleDb().prepare(
    `SELECT expansion FROM snippets WHERE trigger = ?`,
  );
  for (const key of keys) {
    const row = stmt.get(key) as { expansion: string } | undefined;
    if (row?.expansion) return row.expansion;
  }

  // Diagnostic — empty DB was the live 7.2 fail mode ("SIG" → local_cleanup "SIG.").
  try {
    const n = countSnippets();
    console.info(
      `[ripple-snippets] no match for "${keys[0]}" (tried ${keys.length} key(s); ${n} snippet(s) stored)`,
    );
  } catch {
    /* db optional in unit tests that mock resolve */
  }
  return null;
}
