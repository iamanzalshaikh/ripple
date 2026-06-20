import { normalizeHindi } from "../i18n/hindiNormalize.js";
import { normalizeHinglish } from "../i18n/hinglishNormalize.js";
import { normalizeHinglishSlots } from "../i18n/hinglishSlots.js";
import { normalizeSinhala } from "../i18n/sinhalaNormalize.js";
import { normalizeTamil } from "../i18n/tamilNormalize.js";
import { normalizeUrdu } from "../i18n/urduNormalize.js";
import { detectPrimaryScript } from "../i18n/scriptDetect.js";
import { normalizeTranscript } from "../normalizeTranscript.js";
import { normalizeForNlu } from "./normalizeIntent.js";

export type NluPreprocessResult = {
  raw: string;
  nlu: string;
  changed: boolean;
  script: ReturnType<typeof detectPrimaryScript>;
};

let lastCache: { key: string; result: NluPreprocessResult } | null = null;

/**
 * Phase 4.6–4.7 — multilingual preprocess pipeline.
 * Whisper → regional scripts → Hinglish → English NLU normalize → parsers.
 */
export function preprocessForNlu(command?: string | null): NluPreprocessResult {
  const key = (command ?? "").trim();
  if (lastCache?.key === key) return lastCache.result;

  const raw = normalizeTranscript(command ?? "");
  if (!raw) {
    const empty = {
      raw: "",
      nlu: "",
      changed: false,
      script: "latin" as const,
    };
    lastCache = { key, result: empty };
    return empty;
  }

  const script = detectPrimaryScript(raw);
  const afterHindi = normalizeHindi(raw);
  const afterUrdu = normalizeUrdu(afterHindi);
  const afterSinhala = normalizeSinhala(afterUrdu);
  const afterTamil = normalizeTamil(afterSinhala);
  const hinglish = normalizeHinglish(afterTamil);
  const slotted = normalizeHinglishSlots(hinglish);
  let nlu = normalizeForNlu(slotted);
  nlu = nlu
    .replace(/\bname\s+is\b/gi, "named")
    .replace(/\bcall\s+it\b/gi, "named")
    .replace(/\bdownloads?\s+mein\b/gi, "in downloads")
    .replace(/\bdocuments?\s+mein\b/gi, "in documents")
    .replace(/\bdesktop\s+pe\b/gi, "in desktop")
    .trim();
  const changed = nlu.toLowerCase() !== raw.toLowerCase();

  if (changed) {
    console.info(`[ripple-desktop] NLU preprocess: "${raw}" → "${nlu}"`);
  }

  const result = { raw, nlu, changed, script };
  lastCache = { key, result };
  return result;
}

/** Clear preprocess cache between commands (call from orchestrator). */
export function clearPreprocessCache(): void {
  lastCache = null;
}
