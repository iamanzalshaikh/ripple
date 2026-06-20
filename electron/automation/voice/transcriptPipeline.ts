/**
 * UTF-8 transcript pipeline — matches Ripple voice architecture:
 *
 * Whisper STT → Language detect → UTF repair → STT correction → Translation (NLU preprocess) → Intent → Actions
 */
import {
  looksLikeCorruptedRegionalEncoding,
  repairCorruptedTranscript,
} from "./i18n/repairEncoding.js";
import {
  detectPrimaryScript,
  containsDevanagari,
  type ScriptFamily,
} from "./i18n/scriptDetect.js";
import { normalizeTranscript } from "./normalizeTranscript.js";
import { preprocessForNlu } from "./nlu/preprocess.js";
import { correctWhisperMishearings } from "./sttCorrection.js";

export type TranscriptSnapshot = {
  raw: string;
  repaired: string;
  corrected: string;
  normalized: string;
  nlu: string;
  script: ScriptFamily;
  language?: string;
  wasMojibake: boolean;
  wasSttCorrected: boolean;
  hasDevanagari: boolean;
};

/** Safe log preview — Unicode code points, not terminal-dependent glyphs. */
export function transcriptDebugLabel(text: string, maxChars = 48): string {
  const slice = text.slice(0, maxChars);
  const codes = [...slice].map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  const preview = JSON.stringify(slice);
  return `${preview} [${codes.join(" ")}${text.length > maxChars ? " …" : ""}]`;
}

function repairStage(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  return repairCorruptedTranscript(trimmed);
}

/** Full STT → command pipeline (UTF-8 preserved; mojibake repaired; Whisper mishears corrected). */
export function processTranscriptFromStt(
  raw: string,
  language?: string,
): TranscriptSnapshot {
  const repaired = repairStage(raw);
  const corrected = correctWhisperMishearings(repaired);
  const normalized = normalizeTranscript(corrected);
  const { nlu } = preprocessForNlu(normalized);

  return {
    raw: raw.trim(),
    repaired,
    corrected,
    normalized,
    nlu,
    script: detectPrimaryScript(repaired || raw),
    language,
    wasMojibake:
      looksLikeCorruptedRegionalEncoding(raw) &&
      (containsDevanagari(repaired) || repaired !== raw),
    wasSttCorrected: corrected.toLowerCase() !== repaired.toLowerCase(),
    hasDevanagari:
      containsDevanagari(raw) ||
      containsDevanagari(repaired) ||
      containsDevanagari(normalized),
  };
}

/** Best string to feed parsers / GPT — prefer NLU when preprocess translated the utterance. */
export function commandTextFromTranscript(snapshot: TranscriptSnapshot): string {
  const nlu = snapshot.nlu?.trim();
  const normalized = (snapshot.normalized || snapshot.corrected || snapshot.repaired || snapshot.raw).trim();
  if (nlu && nlu.toLowerCase() !== normalized.toLowerCase()) {
    return nlu;
  }
  return normalized || snapshot.raw.trim();
}

/** NLU slot line for GPT when preprocess improved the utterance. */
export function nluTextForGpt(snapshot: TranscriptSnapshot): string | undefined {
  const nlu = snapshot.nlu.trim();
  const cmd = commandTextFromTranscript(snapshot).trim();
  if (!nlu || nlu.toLowerCase() === cmd.toLowerCase()) return undefined;
  return nlu;
}

const DEBUG =
  process.env.RIPPLE_TRANSCRIPT_DEBUG === "1" ||
  process.env.NODE_ENV !== "production";

export function logTranscriptStage(
  stage: string,
  snapshot: Partial<TranscriptSnapshot> & { text?: string },
): void {
  if (!DEBUG && stage !== "stt_raw" && stage !== "command_execute") return;

  const text = snapshot.text ?? snapshot.raw ?? snapshot.normalized ?? "";
  const parts = [
    `[ripple-transcript] ${stage}`,
    snapshot.language ? `lang=${snapshot.language}` : null,
    snapshot.script ? `script=${snapshot.script}` : null,
    snapshot.wasMojibake ? "mojibake_repaired=yes" : null,
    snapshot.wasSttCorrected ? "stt_corrected=yes" : null,
    snapshot.hasDevanagari ? "devanagari=yes" : null,
    text ? `text=${transcriptDebugLabel(text)}` : null,
    snapshot.nlu && snapshot.nlu !== text
      ? `nlu=${transcriptDebugLabel(snapshot.nlu)}`
      : null,
  ].filter(Boolean);

  console.info(parts.join(" | "));
}
