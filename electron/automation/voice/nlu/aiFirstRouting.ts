import type { NativeCommandIntent } from "../../desktop/parseNativeCommand.js";
import { isGmailComposeFocused } from "../../../focus/focusContext.js";
import {
  normalizeDesktopVoiceCommand,
  parseDesktopInputFallback,
} from "../../../agent/parseDesktopInput.js";
import { isRegionalLanguageCommand } from "./desktopIntentGuard.js";
import { isLikelyDesktopCommand } from "./desktopIntentGuard.js";
import { parseDesktopIntent } from "./pipeline.js";
import { preprocessForNlu } from "./preprocess.js";
import { looksLikeCorruptedRegionalEncoding } from "../i18n/repairEncoding.js";

/** Hinglish surface cues — GPT owns interpretation, not regex fast path. */
export const HINGLISH_GPT_MARKERS =
  /\b(?:banao|bana\s*do|ke\s+andar|ke\s+anda|kahande|kahan|naya\s+folder|folder\s+banao|download\s+ke|create\s+karo)\b/i;

function isIncompleteFileOp(intent: NativeCommandIntent): boolean {
  if (intent.kind === "create_folder" || intent.kind === "create_file") {
    if (!intent.parent?.trim()) return true;
    if (!intent.name?.trim()) return true;
    if (/until\s+download/i.test(intent.name)) return true;
  }
  return false;
}

/**
 * P4 AI-first: skip regex/NLU fast path when local parse is missing or unreliable.
 */
export function shouldSkipFastPathForGpt(command?: string | null): boolean {
  const raw = (command ?? "").trim();
  if (!raw) return false;

  const parsed = parseDesktopIntent(command);
  if (!parsed) {
    const { nlu } = preprocessForNlu(command);
    if (parseDesktopIntent(nlu)) return false;
    return HINGLISH_GPT_MARKERS.test(raw);
  }

  if (isIncompleteFileOp(parsed.intent)) return true;

  return false;
}

/**
 * AI-first: GPT reads Whisper raw speech only — no local regex NLU on the wire.
 */
export function shouldUseGptRawOnly(command?: string | null): boolean {
  const raw = (command ?? "").trim();
  if (!raw) return false;
  if (isGmailComposeFocused()) return false;

  if (parseDesktopInputFallback(normalizeDesktopVoiceCommand(raw))) return false;
  if (parseDesktopInputFallback(raw)) return false;

  const { nlu } = preprocessForNlu(command);

  if (parseDesktopIntent(command) || parseDesktopIntent(nlu)) return false;
  if (nlu !== raw && isLikelyDesktopCommand(nlu)) return false;
  if (isCleanEnglishFileOpNlu(nlu)) return false;

  if (
    isRegionalLanguageCommand(raw) ||
    looksLikeCorruptedRegionalEncoding(raw)
  ) {
    return true;
  }

  return shouldSkipFastPathForGpt(command);
}

/** If NLU still looks like Hinglish/Urdu roman, GPT should read raw speech only. */
const HINGLISH_IN_NLU =
  /\b(?:banao|bana\s*do|naam|karo|mein|naya|ke\s+anda?r?|andar|downloadike|kahande)\b/i;

/**
 * NLU passed to GPT only for clean English fast-path misses (e.g. typos in plain English).
 */
export function nluForGptPlanner(command: string, nlu: string): string | undefined {
  const raw = command.trim();
  const normalized = nlu.trim();
  if (!normalized || normalized.toLowerCase() === raw.toLowerCase()) {
    return undefined;
  }

  if (HINGLISH_IN_NLU.test(normalized)) return undefined;
  if (/\bcreate,\s*create\b/i.test(normalized)) return undefined;
  if (/\bnaya\s+create\s+folder\b/i.test(normalized)) return undefined;

  const rawCreates = raw.match(/\bcreate\b/gi)?.length ?? 0;
  const nluCreates = normalized.match(/\bcreate\b/gi)?.length ?? 0;
  if (nluCreates > rawCreates + 1) return undefined;

  return normalized;
}

/** Clean English slot line from preprocess — safe to send GPT when fast path skipped. */
export function isCleanEnglishFileOpNlu(nlu: string): boolean {
  return /^\s*create\s+(?:folder|file)\s+in\s+(?:downloads?|documents?|desktop)\s*,?\s*named\s+\S+/i.test(
    nlu.trim(),
  );
}

/** Single gate for what GPT receives — raw only when AI-first applies. */
export function speechForGptPlanner(
  command: string,
  nlu: string,
): string | undefined {
  if (shouldUseGptRawOnly(command)) {
    if (isCleanEnglishFileOpNlu(nlu)) return nlu.trim();
    if (isLikelyDesktopCommand(nlu)) return nlu.trim();
    return undefined;
  }
  return nluForGptPlanner(command, nlu);
}
