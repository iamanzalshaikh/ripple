/**
 * Phase 7.7 — Nearby on-screen text → bias name/term spelling.
 *
 * Wispr-style Mechanism 1: read visible text near the focused field (UIA,
 * then light OCR fallback) and correct STT tokens that look like misspellings
 * of terms already on screen. Fail-open: any gather/apply error leaves the
 * utterance unchanged.
 *
 * This is NOT Whisper initial_prompt bias — post-STT only, before cleanup.
 */

import {
  getFocusedA11yElement,
  getInsertTextA11yDiagnostics,
} from "../../native/win32Bridge.js";

const MAX_TERMS = 40;
const MAX_CONTEXT_CHARS = 4000;
const GATHER_BUDGET_MS = 350;
/**
 * OCR only when UIA is thin. 280ms was too tight to ever finish a full-screen
 * capture+OCR: live runs showed it completing roughly one time in three
 * (ocrChars=1531 once, then `no_terms chars=238` / `terms=1` with no
 * ocr_fallback line at all). Raised so the fallback is deterministic; actual
 * elapsed time is logged on every run as ocr_ms so the cost stays visible.
 * Still fail-open — a timeout leaves the utterance untouched.
 */
const OCR_BUDGET_MS = 2500;

/**
 * Latency Phase 4 — take the screen gather OFF the critical path.
 *
 * Gathering (UIA + OCR) depends only on what is on screen, never on the
 * transcript, so it does not have to wait for STT to finish. It used to run
 * after the transcript arrived, adding its full wall time (live: 180–480 ms,
 * worst case the 2500 ms OCR budget) directly to stop→paste.
 *
 * Prewarming at `voice:end` overlaps it with the 1.8–3.1 s STT+clean round trip
 * we are already paying for, so by compose time the result is usually already
 * resolved and the wait is ~0 ms. Term quality is identical — same gather, same
 * pinned window, just started earlier.
 */
const PREWARM_TTL_MS = 30_000;

let prewarmed: { promise: Promise<string>; startedAt: number } | null = null;

/**
 * Fire-and-forget: begin gathering screen text now. Safe to call more than once
 * (a still-fresh in-flight gather is reused rather than duplicated) and safe to
 * never consume — the promise cannot reject.
 */
export function prewarmScreenContext(): void {
  if (prewarmed && Date.now() - prewarmed.startedAt < PREWARM_TTL_MS) return;
  const startedAt = Date.now();
  const promise = gatherNearbyScreenText().then(
    (text) => {
      console.info(
        `[ripple-latency] screen_prewarm_done ms=${Date.now() - startedAt} chars=${text.trim().length}`,
      );
      return text;
    },
    () => "",
  );
  prewarmed = { promise, startedAt };
}

/** Test-only — drop any pending prewarm so specs cannot leak into each other. */
export function resetScreenPrewarmForTests(): void {
  prewarmed = null;
}

/**
 * Consume a prewarmed gather when one is fresh, else gather inline. Either way
 * the caller gets the same screen text; only the wall time differs.
 */
async function takeScreenText(): Promise<{
  text: string;
  source: "prewarm" | "inline";
  waitedMs: number;
}> {
  const entry = prewarmed;
  prewarmed = null;
  const startedAt = Date.now();
  if (entry && startedAt - entry.startedAt < PREWARM_TTL_MS) {
    const text = await entry.promise;
    // An empty prewarm (OCR timed out, self-capture discarded, UIA thin) must
    // not silently cost us a name we would previously have found — retry inline
    // so Feature #20 quality is never worse than before, only faster.
    if (text.trim()) {
      return { text, source: "prewarm", waitedMs: Date.now() - startedAt };
    }
    console.info(
      "[ripple-latency] screen_prewarm_empty — regathering inline (quality over latency)",
    );
  }
  const text = await gatherNearbyScreenText();
  return { text, source: "inline", waitedMs: Date.now() - startedAt };
}

/** Strip browser/app chrome from window titles to recover the contact/name. */
const TITLE_BADGE_PREFIX = /^\(\d+\)\s+/;
const TITLE_APP_SUFFIX =
  /\s*[-–—|•·]\s*(WhatsApp|Gmail|Chrome|Instagram|LinkedIn|Notion|Discord|Slack|Teams|Outlook|Messages?|Cursor|Windsurf|Code|Notepad|Word|Excel|PowerPoint|Edge|Firefox)\b.*$/i;

/** Chrome / WhatsApp / Gmail UI chrome — never treat as a name to bias toward. */
const UI_STOPWORDS = new Set(
  [
    "chats",
    "chat",
    "messages",
    "message",
    "contacts",
    "contact",
    "search",
    "type",
    "send",
    "status",
    "updates",
    "whatsapp",
    "gmail",
    "google",
    "chrome",
    "inbox",
    "compose",
    "draft",
    "subject",
    "to",
    "from",
    "cc",
    "bcc",
    "reply",
    "forward",
    "archive",
    "starred",
    "unread",
    "today",
    "yesterday",
    "online",
    "typing",
    "photo",
    "video",
    "document",
    "documents",
    "groups",
    "common",
    "notion",
    "linkedin",
    "instagram",
    "youtube",
    "ripple",
    "notepad",
    "cursor",
    "address",
    "omnibox",
    "new",
    "tab",
    "window",
    "file",
    "edit",
    "view",
    "help",
    "settings",
    "menu",
    "button",
    "close",
    "minimize",
    "maximize",
    "ok",
    "cancel",
    "yes",
    "no",
    "the",
    "and",
    "for",
    "you",
    "your",
    "with",
    "this",
    "that",
    "are",
    "was",
    "were",
    "have",
    "has",
    "had",
    "will",
    "would",
    "could",
    "should",
    "can",
    "may",
    "about",
    "from",
    "into",
    "onto",
    "over",
    "under",
    "hello",
    "hey",
    "hi",
    "dear",
    "thanks",
    "thank",
    "please",
    "regards",
    // Common English — never bias toward UI chrome ("Liked", "Seen", "All")
    "like",
    "liked",
    "likes",
    "all",
    "seen",
    "just",
    "now",
    "ago",
    "when",
    "want",
    "text",
    "someone",
    "using",
    "phone",
    "hands",
    "writing",
    "down",
    "laptop",
    "project",
    "best",
    "knows",
    "know",
    "baat",
    "hai",
    "only",
    "since",
    "focusing",
    "specially",
    "especially",
    "obviously",
    "software",
    "maya",
    // Chat bubbles / greetings — never fuzzy-replace real English into these
    "morning",
    "afternoon",
    "evening",
    "working",
    "main",
    "issue",
    "facing",
    "chick",
    "wake",
    // Notepad / editor status-bar + tab chrome — never a contact name
    "zoom",
    "untitled",
    "plain",
    "column",
    "line",
    "windows",
    "crlf",
    "utf",
  ].map((s) => s.toLowerCase()),
);

export type ScreenBiasReplacement = {
  from: string;
  to: string;
};

export type ScreenBiasResult = {
  text: string;
  terms: string[];
  replacements: ScreenBiasReplacement[];
  sourceChars: number;
};

export type ScreenBiasOptions = {
  /**
   * Names from the active chat header / window title — the term the user is
   * most likely speaking. These get relaxed fuzzy matching and win over
   * sidebar names.
   */
  priorityTerms?: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9'’-]/gi, "");
}

/** Levenshtein distance — small strings only (name-length tokens). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = b.length + 1;
  const cols = a.length + 1;
  const prev = new Array<number>(cols);
  const cur = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j]!;
  }
  return prev[a.length]!;
}

function maxAllowedDistance(termLen: number): number {
  if (termLen <= 3) return 0;
  if (termLen <= 5) return 1;
  if (termLen <= 8) return 2;
  return 3;
}

/** "ummer"→"umer", "rayyan"→"rayan" — STT rarely agrees on doubled letters. */
function collapseDoubles(value: string): string {
  return value.replace(/(.)\1+/g, "$1");
}

/**
 * Loose phonetic key, used ONLY for active-chat-header names.
 *
 * Transliterated names lose/gain a leading H and swap vowels freely in STT:
 * "Humar" / "Umar" / "Ummer" are the same spoken name. Collapsing doubles,
 * dropping a leading H and flattening vowel runs makes those equal while
 * keeping genuinely different names apart (mishra→"mashra" ≠ mishal→"mashal",
 * kumar→"kamar" ≠ ummer→"amar", working→"warkang" ≠ morning→"marnang").
 */
export function phoneticKey(value: string): string {
  return collapseDoubles(value.toLowerCase())
    .replace(/^h/, "")
    .replace(/[aeiou]+/g, "a");
}

/** Space-preserving normalized key for multi-word phrase comparison. */
function phraseKey(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((p) => normalizeToken(p))
    .filter(Boolean)
    .join(" ");
}

/**
 * Match rules for active-chat-header targets only. Deliberately looser than
 * the default path: the header name is the one term we have high confidence
 * the user is actually talking about.
 */
function matchesPriorityTarget(tokNorm: string, targetNorm: string): boolean {
  if (tokNorm === targetNorm) return true;
  if (tokNorm.length < 3 || targetNorm.length < 3) return false;

  // +1 edit budget when the first letter still agrees (Umar→Ummer).
  const relaxedMax = maxAllowedDistance(targetNorm.length) + 1;
  const dist = editDistance(tokNorm, targetNorm);
  if (dist <= relaxedMax && tokNorm[0] === targetNorm[0]) return true;

  // Doubled-letter drift (Rayyan→Rayan) — first letter must still agree.
  if (
    tokNorm[0] === targetNorm[0] &&
    collapseDoubles(tokNorm) === collapseDoubles(targetNorm)
  ) {
    return true;
  }

  // Silent-H / vowel drift (Humar→Ummer). Only for names long enough that a
  // phonetic collision is unlikely.
  if (
    targetNorm.length >= 4 &&
    tokNorm.length >= 4 &&
    phoneticKey(tokNorm) === phoneticKey(targetNorm)
  ) {
    return true;
  }
  return false;
}

function isNamePhraseCandidate(w1: string, w2: string): boolean {
  const a = normalizeToken(w1);
  const b = normalizeToken(w2);
  if (a.length < 3 || b.length < 3) return false;
  return !UI_STOPWORDS.has(a) && !UI_STOPWORDS.has(b);
}

const WORD_SCAN_RE = /\b[A-Za-z][A-Za-z'’-]{0,40}\b/g;

/**
 * Every adjacent Capitalized "First Last" pair, allowing OVERLAP.
 *
 * A single /g regex cannot be used here: on "Hello Kumar Mishra" it consumes
 * "Hello Kumar" and never offers "Kumar Mishra" — which let the wrong-person
 * guard fall through and produced the live "Kumar Mishal" corruption.
 */
function findNamePhrases(
  text: string,
): Array<{ start: number; end: number; w1: string; w2: string }> {
  const words: Array<{ s: number; e: number; t: string }> = [];
  for (const m of text.matchAll(WORD_SCAN_RE)) {
    const idx = m.index ?? 0;
    words.push({ s: idx, e: idx + m[0].length, t: m[0] });
  }
  const phrases: Array<{ start: number; end: number; w1: string; w2: string }> = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i]!;
    const b = words[i + 1]!;
    // Only whitespace may separate them (no commas / punctuation).
    if (!/^\s+$/.test(text.slice(a.e, b.s))) continue;
    if (!/^[A-Z]/.test(a.t) || !/^[A-Z]/.test(b.t)) continue;
    if (!isNamePhraseCandidate(a.t, b.t)) continue;
    phrases.push({ start: a.s, end: b.e, w1: a.t, w2: b.t });
  }
  return phrases;
}

/**
 * Recover contact / person names from window-title style lines.
 * Examples: "Anzal Khan - WhatsApp", "(3) Anzal | Instagram", "Anzal - Chrome".
 */
/**
 * True when a line could plausibly be a person's display name.
 * Rejects filenames, paths, URLs, phone numbers and anything with digits —
 * these are what made editor/browser titles masquerade as chat headers.
 */
export function isPersonNameLike(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 48) return false;
  if (/\d/.test(v)) return false;
  if (/[./\\@:_]/.test(v)) return false;
  const words = v.split(/\s+/);
  if (words.length > 4) return false;
  return words.every((w) => /^[A-Za-z][A-Za-z'’-]*$/.test(w));
}

export function extractTitlePriorityTerms(screenText: string): string[] {
  const found = new Map<string, string>();
  for (const rawLine of screenText.split(/\n+/)) {
    let line = rawLine.trim();
    if (!line || line.length > 120) continue;
    line = line.replace(TITLE_BADGE_PREFIX, "").trim();
    const stripped = line.replace(TITLE_APP_SUFFIX, "").trim();
    // Only treat as a title name when we actually stripped an app suffix,
    // or the line is a short Capitalized Name Name phrase.
    const looksLikeTitle =
      stripped !== line ||
      /^(?:Dr\.?\s+|Mr\.?\s+|Ms\.?\s+|Mrs\.?\s+)?[A-Z][a-zA-Z'’-]{1,30}(?:\s+[A-Z][a-zA-Z'’-]{1,30}){0,3}$/.test(
        stripped,
      );
    if (!looksLikeTitle || !stripped) continue;

    // A person's name — not a filename, path, phone number or URL. Editor
    // titles ("screen-bias-loop.md - projectRipple - Cursor") and WhatsApp's
    // "Type a message to +971…" otherwise register as strong name signals,
    // which suppressed the OCR fallback that actually finds the chat header.
    if (!isPersonNameLike(stripped)) continue;

    const key = normalizeToken(stripped);
    if (key.length < 3) continue;
    if (UI_STOPWORDS.has(key)) continue;
    const parts = stripped.split(/\s+/);
    if (parts.every((p) => UI_STOPWORDS.has(p.toLowerCase()))) continue;
    if (!found.has(key)) found.set(key, stripped);

    for (const part of parts) {
      const pk = normalizeToken(part);
      if (pk.length < 3 || UI_STOPWORDS.has(pk)) continue;
      if (!found.has(pk)) found.set(pk, part);
    }
  }
  return [...found.values()];
}

/**
 * Names that appear MORE THAN ONCE anywhere on screen.
 *
 * OCR of WhatsApp Web never yields a clean "Ummer Mishal" line — the header
 * text is glued to neighbours ("Ummer Mishal Assalamualikurn Walikumsalaam",
 * "All Bookmarks Ummer Mishal"), so line-based title extraction finds nothing.
 * But the OPEN chat's name is repeated across header + sidebar + bubbles,
 * while other sidebar contacts appear once. Frequency therefore identifies the
 * active conversation without needing pixel coordinates.
 */
export function extractRepeatedNamePhrases(
  screenText: string,
  minCount = 2,
): string[] {
  const counts = new Map<string, { display: string; n: number }>();
  for (const line of screenText.split(/\n+/)) {
    for (const phrase of findNamePhrases(line)) {
      const display = `${phrase.w1} ${phrase.w2}`;
      if (!isPersonNameLike(display)) continue;
      const key = phraseKey(display);
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { display, n: 1 });
    }
  }
  return [...counts.values()]
    .filter((v) => v.n >= minCount)
    .sort((a, b) => b.n - a.n)
    .map((v) => v.display);
}

/**
 * Pull candidate proper nouns / uncommon terms from gathered screen text.
 * Prefers window-title names, then Capitalized tokens / multi-word patterns.
 */
export function extractCandidateTerms(screenText: string): string[] {
  const text = screenText.replace(/\s+/g, " ").trim();
  if (!text) return [];

  const found = new Map<string, string>(); // lower → display form

  // Title / chat-header names first (highest trust for Ansal→Anzal cases).
  const titleTerms = extractTitlePriorityTerms(screenText);
  for (const term of titleTerms) {
    const key = normalizeToken(term);
    if (key && !found.has(key)) found.set(key, term);
  }

  // Multi-word names: "Amaal Ahamed", "Dr. Fatima"
  const multi =
    screenText.match(
      /\b(?:Dr\.?\s+|Mr\.?\s+|Ms\.?\s+|Mrs\.?\s+)?[A-Z][a-zA-Z'’-]{1,30}(?:\s+[A-Z][a-zA-Z'’-]{1,30}){1,3}\b/g,
    ) ?? [];
  for (const m of multi) {
    const key = normalizeToken(m);
    if (key.length < 4) continue;
    if (![...m.split(/\s+/)].some((p) => !UI_STOPWORDS.has(p.toLowerCase()))) {
      continue;
    }
    if (!found.has(key)) found.set(key, m.trim());
  }

  // Single Capitalized tokens (and ALLCAPS short acronyms 2–6)
  const singles =
    screenText.match(/\b[A-Z][a-zA-Z'’-]{2,40}\b|\b[A-Z]{2,6}\b/g) ?? [];
  for (const m of singles) {
    const key = normalizeToken(m);
    if (!key || key.length < 3) continue;
    if (UI_STOPWORDS.has(key)) continue;
    // Prefer longer / already-captured multi forms
    if (!found.has(key)) found.set(key, m.trim());
  }

  // Title terms stay first; then longer proper nouns.
  const titleKeys = new Set(titleTerms.map((t) => normalizeToken(t)));
  return [...found.values()]
    .sort((a, b) => {
      const aTitle = titleKeys.has(normalizeToken(a)) ? 1 : 0;
      const bTitle = titleKeys.has(normalizeToken(b)) ? 1 : 0;
      if (aTitle !== bTitle) return bTitle - aTitle;
      return b.length - a.length;
    })
    .slice(0, MAX_TERMS);
}

/**
 * Replace utterance tokens that are close misspellings of on-screen terms.
 * Exact case-insensitive matches still rewrite to the on-screen casing.
 */
export function applyScreenNameBias(
  utterance: string,
  terms: string[],
  options?: ScreenBiasOptions,
): ScreenBiasResult {
  if (!utterance.trim() || terms.length === 0) {
    return { text: utterance, terms, replacements: [], sourceChars: 0 };
  }

  const replacements: ScreenBiasReplacement[] = [];
  let out = utterance;

  const priorityTerms = (options?.priorityTerms ?? []).filter((t) => t.trim());
  const priorityKeys = new Set(priorityTerms.map((t) => normalizeToken(t)));
  /** Header parts we must NOT fuzzy-apply (user clearly named someone else). */
  const suppressed = new Set<string>();

  // --- Pass 1: whole-phrase correction --------------------------------------
  // "Umar Misal" → "Ummer Mishal" as one unit, so we never fix only the last
  // name and leave a wrong first name behind. Header names run first (relaxed
  // rules), then any other multi-word screen name (strict rules).
  const multiWordTargets: Array<{ term: string; priority: boolean }> = [
    ...priorityTerms
      .filter((t) => /\s/.test(t.trim()))
      .map((t) => ({ term: t.trim(), priority: true })),
    ...terms
      .filter(
        (t) =>
          /\s/.test(t.trim()) && !priorityKeys.has(normalizeToken(t)),
      )
      .map((t) => ({ term: t.trim(), priority: false })),
  ];

  for (const { term: phrase, priority: isPriorityPhrase } of multiWordTargets) {
    const target = phrase;
    const targetKey = phraseKey(target);
    if (!targetKey.includes(" ")) continue;

    const candidates = findNamePhrases(out);
    const sawNameCandidate = candidates.length > 0;
    let phraseMatched = false;
    const limit =
      maxAllowedDistance(targetKey.length) + (isPriorityPhrase ? 1 : 0);
    // The FIRST name anchors identity. "Umar Masai" is the same person as
    // "Ummer Mishal" badly transcribed (Umar~Ummer), while "Kumar Mishra" is
    // someone else entirely — even though both are far apart on raw phrase
    // distance. Without this anchor the whole-phrase check failed on
    // "Umar Masai" and the sidebar guard then blocked the per-token fix too.
    const headerFirst = normalizeToken(target.split(/\s+/)[0] ?? "");

    for (const cand of candidates) {
      const candKey = phraseKey(`${cand.w1} ${cand.w2}`);
      if (candKey === targetKey) {
        phraseMatched = true;
        break;
      }
      const firstNameAnchored =
        isPriorityPhrase &&
        headerFirst.length >= 3 &&
        matchesPriorityTarget(normalizeToken(cand.w1), headerFirst);
      if (firstNameAnchored || editDistance(candKey, targetKey) <= limit) {
        const matched = out.slice(cand.start, cand.end);
        out = out.slice(0, cand.start) + target + out.slice(cand.end);
        replacements.push({ from: matched, to: target });
        phraseMatched = true;
        break;
      }
    }

    // The utterance named a DIFFERENT two-word person than the open chat.
    // Block this header's parts from firing per-token, which is what turned
    // "Kumar Mishra" into "Kumar Mishal" from sidebar noise.
    if (isPriorityPhrase && !phraseMatched && sawNameCandidate) {
      for (const part of target.split(/\s+/)) {
        const key = normalizeToken(part);
        if (key) suppressed.add(key);
      }
      suppressed.add(normalizeToken(target));
    }
  }

  // --- Protect whole names the user actually spoke ---------------------------
  // Any "First Last" still standing after the phrase pass did NOT match a
  // screen name, so the user is talking about someone else. Half-fixing it
  // token-by-token is how "Kumar Mishra" became "Kumar Mishal" — and that
  // happened even with headerTerms=0, where no header guard exists at all.
  // Exact-case normalization is still allowed; only fuzzy edits are blocked.
  const knownPhraseKeys = new Set(
    [...priorityTerms, ...terms]
      .filter((t) => /\s/.test(t.trim()))
      .map((t) => phraseKey(t)),
  );
  const protectedTokens = new Set<string>();
  for (const cand of findNamePhrases(out)) {
    if (knownPhraseKeys.has(phraseKey(`${cand.w1} ${cand.w2}`))) continue;
    protectedTokens.add(normalizeToken(cand.w1));
    protectedTokens.add(normalizeToken(cand.w2));
  }

  // Build flat list of bias targets: full multi-word terms + each significant part
  const targets: string[] = [];
  // Header names FIRST and unconditionally. `terms` is capped at MAX_TERMS and
  // sorted by length, so a short contact name could be squeezed out by longer
  // OCR junk and never become a target at all — live 2026-08-20:
  // headerTerms=[Mehrin, …, Professional Jewelry, ZBRUSH JEWELRY] yet
  // "Mehreen" was left uncorrected because "Mehrin" was not in the target list.
  for (const term of [...priorityTerms, ...terms]) {
    targets.push(term);
    for (const part of term.split(/\s+/)) {
      if (part.length >= 3 && !UI_STOPWORDS.has(part.toLowerCase())) {
        targets.push(part);
      }
    }
  }
  // Longest first so "Amaal Ahamed" wins over "Amaal"
  const uniqueTargets = [...new Map(targets.map((t) => [normalizeToken(t), t])).values()].sort(
    (a, b) => b.length - a.length,
  );

  for (const target of uniqueTargets) {
    // Multi-word targets are handled by the phrase pass. The token regex below
    // matches ONE word, so letting "Aisha Khan" (normalized "aishakhan") match
    // the single token "Aisha" replaced one word with two — producing
    // "Hello Aisha Khan Khan". Their individual parts are already in the
    // target list, so nothing is lost by skipping them here.
    if (/\s/.test(target.trim())) continue;
    const targetNorm = normalizeToken(target);
    if (!targetNorm) continue;
    if (UI_STOPWORDS.has(targetNorm)) continue;
    // Instagram/WhatsApp chrome often exposes "Liked" / "Seen" — never bias to those.
    if (/^(liked|likes|seen|sent|online|active)$/i.test(targetNorm)) continue;
    if (suppressed.has(targetNorm)) continue;
    const isPriority = priorityKeys.has(targetNorm);
    const maxDist = maxAllowedDistance(targetNorm.length);

    // Tokenize utterance into words while preserving separators via replace callback
    out = out.replace(/\b[A-Za-z][A-Za-z'’-]{1,40}\b/g, (token) => {
      const tokNorm = normalizeToken(token);
      if (!tokNorm || tokNorm.length < 3) return token;
      if (UI_STOPWORDS.has(tokNorm)) return token;
      // Already exact (ignore case) — only normalize casing for name-like targets
      // (Capitalized / multi-case), never rewrite "like" → "Liked".
      if (tokNorm === targetNorm) {
        const targetLooksLikeName =
          /[A-Z]/.test(target.slice(0, 1)) && target !== target.toUpperCase();
        if (token !== target && targetLooksLikeName && token.toLowerCase() === targetNorm) {
          // Avoid promoting common words to Title Case UI labels
          if (UI_STOPWORDS.has(tokNorm)) return token;
          replacements.push({ from: token, to: target });
          return target;
        }
        return token;
      }
      // Active-chat-header names: looser rules (doubled letters, silent H,
      // +1 edit budget). Scoped to the one name we know the user is looking at.
      if (isPriority) {
        if (protectedTokens.has(tokNorm)) return token;
        if (Math.abs(tokNorm.length - targetNorm.length) > maxDist + 2) {
          return token;
        }
        if (matchesPriorityTarget(tokNorm, targetNorm)) {
          replacements.push({ from: token, to: target });
          return target;
        }
        return token;
      }

      // Part of a full name the user spoke that matched nothing on screen.
      if (protectedTokens.has(tokNorm)) return token;

      // Don't rewrite common short words into long names
      if (Math.abs(tokNorm.length - targetNorm.length) > maxDist + 1) {
        return token;
      }
      const dist = editDistance(tokNorm, targetNorm);
      if (dist > 0 && dist <= maxDist) {
        // STT name misspellings almost always keep the first letter
        // ("Tatheer"→"Tathir"). "working"→"Morning" must never win.
        if (tokNorm[0] !== targetNorm[0]) return token;
        replacements.push({ from: token, to: target });
        return target;
      }
      return token;
    });
  }

  // Dedupe replacement log (same from→to)
  const seen = new Set<string>();
  const uniqueReplacements = replacements.filter((r) => {
    const k = `${r.from.toLowerCase()}→${r.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    text: out,
    terms,
    replacements: uniqueReplacements,
    sourceChars: 0,
  };
}

async function gatherUiaScreenText(): Promise<string> {
  const parts: string[] = [];
  try {
    const focused = await getFocusedA11yElement();
    if (focused?.value?.trim()) parts.push(focused.value.trim());
    if (focused?.name?.trim()) parts.push(focused.name.trim());
  } catch {
    /* ignore */
  }

  try {
    const diag = await getInsertTextA11yDiagnostics();
    if (diag?.windowTitle?.trim()) parts.push(diag.windowTitle.trim());
    if (diag?.focused?.value?.trim()) parts.push(diag.focused.value.trim());
    if (diag?.focused?.name?.trim()) parts.push(diag.focused.name.trim());
    for (const node of diag?.ancestorChain ?? []) {
      if (node.value?.trim()) parts.push(node.value.trim());
      if (node.name?.trim() && node.name.length < 80) parts.push(node.name.trim());
    }
    for (const node of diag?.editableElements ?? []) {
      if (node.value?.trim()) parts.push(node.value.trim());
      if (node.name?.trim() && node.name.length < 80) parts.push(node.name.trim());
    }
  } catch {
    /* ignore */
  }

  return parts.join("\n").slice(0, MAX_CONTEXT_CHARS);
}

/**
 * Text that proves we captured RIPPLE'S OWN UI instead of the user's app.
 *
 * Live 2026-08-20: with the dashboard open, full-screen OCR returned
 * "Ripple Dashboard Voice typing for Windows • noor@gmail.com / Notes Language
 * Styles Snippets Dictionary History Log" — our own window, sitting on top of
 * WhatsApp. Biasing toward that is worse than not biasing at all.
 */
const SELF_UI_MARKERS = [
  "ripple dashboard",
  "voice typing for windows",
  "notes language styles snippets",
  "styles snippets dictionary",
];

function looksLikeOwnUi(text: string): boolean {
  const t = text.toLowerCase();
  return SELF_UI_MARKERS.some((m) => t.includes(m));
}

async function gatherOcrFallback(): Promise<string> {
  try {
    const { captureScreenOcr } = await import("../../automation/ai/aiHelpers.js");
    // Target the pinned chat window explicitly rather than the whole screen —
    // otherwise anything stacked above it (including Ripple itself) is what
    // gets read.
    const { resolveTypingFocusTarget } = await import(
      "../../focus/focusContext.js"
    );
    const target = resolveTypingFocusTarget();
    const { ocr } = await captureScreenOcr(target?.hwnd);
    const text = (ocr?.text ?? "").slice(0, MAX_CONTEXT_CHARS);
    if (looksLikeOwnUi(text)) {
      console.warn(
        "[ripple-screen-bias] ocr_self_capture — read Ripple's own window, discarding (close/minimize the Ripple window to enable on-screen name spelling)",
      );
      return "";
    }
    return text;
  } catch {
    return "";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
}

/**
 * Only a full "First Last" counts as a confident header name.
 *
 * A single capitalized word is far too weak: Notepad's status bar ("Zoom"),
 * editor tabs and browser chrome all produce one-word "names" that used to
 * satisfy this check and suppress the OCR fallback — so the real chat header
 * was never read (live: headerTerms=[Zoom], no ocr_fallback).
 */
/**
 * Header names are cached per CHAT, not per dictation.
 *
 * OCR text varies between captures (sidebar scroll, message churn, character
 * noise), so the repeated-name detector found "Ummer Mishal" on one run and
 * nothing on the next — live runs alternated headerTerms=6 / 0 / 0 in the same
 * chat. The chat itself obviously did not change. Keying on WhatsApp's own
 * composer hint gives a stable identity that auto-invalidates the moment the
 * user switches conversation.
 */
const HEADER_CACHE_TTL_MS = 10 * 60 * 1000;
const headerCache = new Map<string, { terms: string[]; at: number }>();

/** Stable identity for the open conversation ("Type a message to X"). */
export function chatKeyFromScreenText(screenText: string): string | null {
  const hint = screenText.match(/Type a message to ([^\n]{1,80})/i);
  if (hint?.[1]) return `chat:${hint[1].trim().toLowerCase()}`;
  const firstLine = screenText.split(/\n/).find((l) => l.trim());
  return firstLine ? `win:${firstLine.trim().toLowerCase()}` : null;
}

/**
 * Saved contacts / groups expose their display name directly in the composer
 * hint. Unsaved contacts show a phone number, which isPersonNameLike rejects.
 */
export function headerNameFromComposerHint(screenText: string): string | null {
  const m = screenText.match(/Type a message to (?:group\s+)?([^\n]{1,80})/i);
  const raw = m?.[1]?.trim();
  if (!raw || !isPersonNameLike(raw)) return null;
  return raw;
}

function hasStrongNameSignal(screenText: string): boolean {
  return extractTitlePriorityTerms(screenText).some((t) => /\s/.test(t.trim()));
}

/** Gather nearby screen text (UIA first; OCR if thin). Budgeted for dictation latency. */
export async function gatherNearbyScreenText(): Promise<string> {
  const uia = await withTimeout(gatherUiaScreenText(), GATHER_BUDGET_MS, "");

  // Group chats often expose sender names inside message bubbles that are
  // NOT present in the accessibility tree. In that case, UIA yields only
  // app chrome (e.g. "WhatsApp", "Search") and we must fall back to full-screen
  // OCR to pick up the actual on-screen name.
  const uiaTerms = uia.trim() ? extractCandidateTerms(uia) : [];
  // OCR runs whenever UIA gives us no *header* name. WhatsApp Web and Cursor
  // both expose plenty of UIA junk (>=2 terms) while the open-chat name lives
  // only in pixels — the old `uiaTerms.length >= 2` early return is why live
  // runs showed no ocr_fallback line at all.
  if (uiaTerms.length >= 1 && hasStrongNameSignal(uia)) return uia;

  const ocrStartedAt = Date.now();
  const ocr = await withTimeout(gatherOcrFallback(), OCR_BUDGET_MS, "");
  const ocrMs = Date.now() - ocrStartedAt;
  if (ocr.trim()) {
    console.info(
      `[ripple-screen-bias] ocr_fallback uiaTerms=${uiaTerms.length} ocrChars=${ocr.trim().length} ocr_ms=${ocrMs}`,
    );
  } else {
    // Never silent: a timed-out / empty OCR is why live runs showed no header.
    console.warn(
      `[ripple-screen-bias] ocr_empty uiaTerms=${uiaTerms.length} ocr_ms=${ocrMs} budget=${OCR_BUDGET_MS}`,
    );
  }
  if (!uia.trim()) return ocr;
  if (!ocr.trim()) return uia;
  return `${uia}\n${ocr}`.slice(0, MAX_CONTEXT_CHARS);
}

/**
 * Full 7.7 path: gather screen → extract terms → bias utterance.
 * Fail-open to the original utterance.
 */
export async function biasUtteranceFromScreen(
  utterance: string,
): Promise<ScreenBiasResult> {
  const empty: ScreenBiasResult = {
    text: utterance,
    terms: [],
    replacements: [],
    sourceChars: 0,
  };
  if (!utterance.trim()) return empty;

  try {
    const gathered = await takeScreenText();
    const screenText = gathered.text;
    console.info(
      `[ripple-latency] screen_bias_wait ms=${gathered.waitedMs} source=${gathered.source}`,
    );
    if (!screenText.trim()) {
      console.info("[ripple-screen-bias] no_terms reason=empty_screen_text");
      return empty;
    }
    const terms = extractCandidateTerms(screenText);
    if (terms.length === 0) {
      console.info(
        `[ripple-screen-bias] no_terms reason=no_candidates chars=${screenText.length}`,
      );
      return { ...empty, sourceChars: screenText.length };
    }
    // Header names: clean title lines first, then names repeated across the
    // screen (the open WhatsApp/Instagram chat), plus their individual parts
    // so per-token matching ("Umar"→"Ummer") can use the relaxed rules.
    const repeated = extractRepeatedNamePhrases(screenText);
    const hintName = headerNameFromComposerHint(screenText);
    let priorityTerms = [
      ...new Set([
        ...extractTitlePriorityTerms(screenText),
        ...(hintName ? [hintName, ...hintName.split(/\s+/)] : []),
        ...repeated,
        ...repeated.flatMap((r) => r.split(/\s+/)),
      ]),
    ].filter((t) => t.trim() && !UI_STOPWORDS.has(normalizeToken(t)));

    // Reuse / refresh the per-chat header so a noisy OCR frame cannot silently
    // drop the name mid-conversation.
    const chatKey = chatKeyFromScreenText(screenText);
    if (chatKey) {
      if (priorityTerms.length) {
        headerCache.set(chatKey, { terms: priorityTerms, at: Date.now() });
      } else {
        const cached = headerCache.get(chatKey);
        if (cached && Date.now() - cached.at < HEADER_CACHE_TTL_MS) {
          priorityTerms = cached.terms;
          console.info(
            `[ripple-screen-bias] headerTerms_from_cache=[${priorityTerms
              .slice(0, 4)
              .join(", ")}]`,
          );
        }
      }
    }
    console.info(
      `[ripple-screen-bias] gather chars=${screenText.length} terms=${terms.length} headerTerms=${priorityTerms.length}`,
    );
    if (process.env.RIPPLE_SCREEN_BIAS_DEBUG === "1") {
      console.info(
        `[ripple-screen-bias] debug_terms=[${terms.slice(0, 12).join(" | ")}]`,
      );
      console.info(
        `[ripple-screen-bias] debug_sample=${JSON.stringify(screenText.slice(0, 600))}`,
      );
    }
    if (priorityTerms.length) {
      console.info(
        `[ripple-screen-bias] headerTerms=[${priorityTerms.slice(0, 6).join(", ")}]`,
      );
    }
    const applied = applyScreenNameBias(utterance, terms, { priorityTerms });
    if (applied.replacements.length) {
      console.info(
        `[ripple-screen-bias] appliedFixes=[${applied.replacements
          .map((r) => `${r.from}→${r.to}`)
          .join(", ")}]`,
      );
    }
    return { ...applied, sourceChars: screenText.length };
  } catch (e: unknown) {
    console.warn(
      "[ripple-screen-bias] failed open:",
      e instanceof Error ? e.message : e,
    );
    return empty;
  }
}
