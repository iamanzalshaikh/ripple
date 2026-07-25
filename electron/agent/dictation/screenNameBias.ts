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
const GATHER_BUDGET_MS = 280;

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

/**
 * Pull candidate proper nouns / uncommon terms from gathered screen text.
 * Prefers Capitalized tokens and multi-word Name Name patterns.
 */
export function extractCandidateTerms(screenText: string): string[] {
  const text = screenText.replace(/\s+/g, " ").trim();
  if (!text) return [];

  const found = new Map<string, string>(); // lower → display form

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

  // Also keep lowercase uncommon tokens from composer value that look like names
  // (UIA value often has mixed case from prior dictation).
  return [...found.values()]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_TERMS);
}

/**
 * Replace utterance tokens that are close misspellings of on-screen terms.
 * Exact case-insensitive matches still rewrite to the on-screen casing.
 */
export function applyScreenNameBias(
  utterance: string,
  terms: string[],
): ScreenBiasResult {
  if (!utterance.trim() || terms.length === 0) {
    return { text: utterance, terms, replacements: [], sourceChars: 0 };
  }

  const replacements: ScreenBiasReplacement[] = [];
  let out = utterance;

  // Build flat list of bias targets: full multi-word terms + each significant part
  const targets: string[] = [];
  for (const term of terms) {
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
    const targetNorm = normalizeToken(target);
    if (!targetNorm) continue;
    if (UI_STOPWORDS.has(targetNorm)) continue;
    // Instagram/WhatsApp chrome often exposes "Liked" / "Seen" — never bias to those.
    if (/^(liked|likes|seen|sent|online|active)$/i.test(targetNorm)) continue;
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
      // Don't rewrite common short words into long names
      if (Math.abs(tokNorm.length - targetNorm.length) > maxDist + 1) {
        return token;
      }
      const dist = editDistance(tokNorm, targetNorm);
      if (dist > 0 && dist <= maxDist) {
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

async function gatherOcrFallback(): Promise<string> {
  try {
    const { captureScreenOcr } = await import("../../automation/ai/aiHelpers.js");
    const { ocr } = await captureScreenOcr();
    return (ocr?.text ?? "").slice(0, MAX_CONTEXT_CHARS);
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

/** Gather nearby screen text (UIA first; OCR if thin). Budgeted for dictation latency. */
export async function gatherNearbyScreenText(): Promise<string> {
  const uia = await withTimeout(gatherUiaScreenText(), GATHER_BUDGET_MS, "");
  if (uia.trim().length >= 24) return uia;
  const ocr = await withTimeout(gatherOcrFallback(), GATHER_BUDGET_MS, "");
  if (!uia.trim()) return ocr;
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
    const screenText = await gatherNearbyScreenText();
    if (!screenText.trim()) return empty;
    const terms = extractCandidateTerms(screenText);
    if (terms.length === 0) return { ...empty, sourceChars: screenText.length };
    const applied = applyScreenNameBias(utterance, terms);
    return { ...applied, sourceChars: screenText.length };
  } catch (e: unknown) {
    console.warn(
      "[ripple-screen-bias] failed open:",
      e instanceof Error ? e.message : e,
    );
    return empty;
  }
}
