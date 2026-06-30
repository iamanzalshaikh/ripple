import { guidedNotFound } from "../../planner/guidedResponses.js";
import { isDesktopIntent } from "./pipeline.js";
import { preprocessForNlu } from "./preprocess.js";
import {
  containsArabicScript,
  containsBengali,
  containsDevanagari,
  containsSinhala,
  containsTamil,
  isRegionalDesktopScript,
} from "../i18n/scriptDetect.js";
import { looksLikeCorruptedRegionalEncoding } from "../i18n/repairEncoding.js";
import { detectSpokenLanguage } from "../i18n/spokenLanguage.js";

/** Tokens that suggest a desktop/local action — not cloud AI generation. */
const DESKTOP_NOUNS =
  /\b(downloads?|documents?|desktop|folder|folders?|file|files?|resume|invoice|project|calculator|notepad|paint|explorer|settings|bluetooth|wifi|workflow|alias|portfolio|rizume|pdf|browser)\b/i;

const DESKTOP_VERBS =
  /\b(open|show|pull\s+up|bring\s+up|find|create|rename|move|delete|lock|launch|start|run|switch|close|minimize|remember|forget|reopen|go\s+back|undo|revert|wapas|kholo|karo|dikhao|search)\b/i;

const DESKTOP_UNDO =
  /\b(?:undo(?:\s+last(?:\s+action)?)?|revert(?:\s+last(?:\s+action)?)?|wapas\s+karo|wapas\s+kar\s*do|undo\s+kar\s*do)\b/i;

const DESKTOP_RECALL =
  /\b(open\s+it\s+again|same\s+(?:thing|file|folder)\s+again|go\s+back|bring\s+(?:it|that)\s+back|last\s+(?:file|folder|download))\b/i;

const HINGLISH_DESKTOP =
  /\b(?:download|downloads|document|desktop)\s+(?:kholo|karo|open)\b/i;

const HINGLISH_FOLDER_VERBS =
  /\b(?:downloads?|documents?|desktop)\s+(?:kholo|khol\s*do|open\s*karo|dikhao|le\s*aao)\b/i;

const REGIONAL_DESKTOP_VERBS =
  /(?:खोल|दिख|भेज|सर्च|डाउन|फाइल|फोल्डर|रिज्यूम|کھولو|ڈاؤن|فائل|ریزیوم|විවෘත|ඕපන්|ඩවුන්|திற|பதிவிறக்க)/u;

/**
 * True when the utterance is probably a desktop command — should never go to backend navigation.
 */
export function isLikelyDesktopCommand(command?: string | null): boolean {
  if (isDesktopIntent(command)) return true;

  const { raw, nlu } = preprocessForNlu(command);
  if (!raw) return false;

  if (isRegionalDesktopScript(raw) && REGIONAL_DESKTOP_VERBS.test(raw)) {
    return true;
  }

  const text = `${raw} ${nlu}`.toLowerCase();

  if (DESKTOP_RECALL.test(text)) return true;
  if (DESKTOP_UNDO.test(text)) return true;
  if (HINGLISH_DESKTOP.test(text)) return true;
  if (HINGLISH_FOLDER_VERBS.test(text)) return true;
  if (DESKTOP_VERBS.test(text) && DESKTOP_NOUNS.test(text)) return true;

  if (/\b(?:banao|bana\s*do|ke\s+andar|naya\s+folder)\b/i.test(text)) {
    return true;
  }

  if (/\b(?:open|show|upon)\s+(?:my\s+)?(?:downloads?|documents?|desktop)\b/i.test(text)) {
    return true;
  }

  if (
    /\b(?:open|launch|start|switch\s+to|close)\s+(?:the\s+)?(?:vs\s*code|cursor|chrome|spotify|discord|calculator|notepad)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}

/** True when speech uses a regional script — prefer local + LLM, not cloud navigation. */
export function isRegionalLanguageCommand(command?: string | null): boolean {
  const raw = (command ?? "").trim();
  if (!raw) return false;
  if (looksLikeCorruptedRegionalEncoding(raw)) return true;
  if (
    containsDevanagari(raw) ||
    containsArabicScript(raw) ||
    containsSinhala(raw) ||
    containsTamil(raw) ||
    containsBengali(raw)
  ) {
    return true;
  }
  const lang = detectSpokenLanguage(raw);
  return lang === "hinglish" || lang === "hindi" || lang === "urdu";
}

export function desktopBlockedMessage(command: string): string {
  return guidedNotFound(command);
}
