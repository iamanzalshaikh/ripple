import { preprocessForNlu } from "../nlu/preprocess.js";
import {
  containsArabicScript,
  containsDevanagari,
  type ScriptFamily,
} from "./scriptDetect.js";

export type SpokenLanguage = "english" | "hinglish" | "hindi" | "urdu";

const HINGLISH_MARKERS =
  /\b(?:bhai|yaar|yar|kholo|khol\s*do|kar\s*do|karo|banao|bana\s*do|mera|meri|mere|dikhao|bhej|naam|mein|aur|phir|kal|aaj|wapas|dubara|chalu|band)\b/i;

const URDU_ROMAN_MARKERS =
  /\b(?:mujhe|mujhko|aapka|aapki|kholiye|khol\s*den|zaroor|rizume|rizume|dastavez|shukriya|haan|nahi|aap|tumhe|khud)\b/i;

/** Detect user's spoken language for localized responses (not STT language tag). */
export function detectSpokenLanguage(command?: string | null): SpokenLanguage {
  const raw = (command ?? "").trim();
  if (!raw) return "english";

  const { script, nlu, raw: preRaw } = preprocessForNlu(raw);
  const text = `${preRaw} ${nlu}`.toLowerCase();

  if (containsDevanagari(raw) || script === "devanagari") return "hindi";
  if (containsArabicScript(raw) || script === "arabic") return "urdu";
  if (URDU_ROMAN_MARKERS.test(text)) return "urdu";
  if (HINGLISH_MARKERS.test(text)) return "hinglish";

  return "english";
}

export function scriptFamilyFor(command: string): ScriptFamily {
  return preprocessForNlu(command).script;
}
