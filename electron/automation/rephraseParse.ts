import { isEditOrRephraseCommand } from "./commandIntent.js";

const TONE_SUFFIX =
  /\s*[,.\s]+\s*(emotional|emotionally|confident|confidently|sad|sadly|angry|angrily|mad|formal|casual|professional|friendly)\s*$/i;

/** Map spoken tone → backend rewrite step. */
export function detectToneRewriteStep(command: string): string | null {
  const c = command.toLowerCase();
  if (/\b(emotional|emotionally|warm|empathetic)\b/.test(c)) return "rewrite_emotional";
  if (/\b(confident|confidence|assertive)\b/.test(c)) return "rewrite_confident";
  if (/\b(sad|sadly|sorrow|upset)\b/.test(c)) return "rewrite_sad";
  if (/\b(angry|angrily|mad|furious)\b/.test(c)) return "rewrite_angry";
  if (/\b(professional|professionally|polished)\b/.test(c)) return "rewrite_professional";
  if (/\b(formal|formally)\b/.test(c)) return "rewrite_formal";
  if (/\b(casual|friendly|relaxed)\b/.test(c)) return "rewrite_casual";
  if (/\b(short|shorter|concise|brief)\b/.test(c)) return "rewrite_short";
  if (/\b(long|longer|expand|detailed)\b/.test(c)) return "rewrite_long";
  return null;
}

const MAKE_IT_TONE =
  /\s*[,]?\s*make\s+it\s+(?:more\s+)?(?:emotional|confident|sad|angry|mad|formal|casual|professional|friendly|short|long)\s*$/i;

const MAKE_THIS_TEXT_TONE =
  /\s*[,]?\s*make\s+(?:this|that)\s+text\s+(?:more\s+)?(?:emotional|confident|sad|angry|mad|formal|casual|professional|friendly|short|long)\s*$/i;

/** Voice command looks like edit/rephrase — strip Whisper duplicate phrases. */
export function normalizeRephraseCommand(command: string): string {
  const cmd = command.trim();
  const dup = cmd.match(/^(.+?),\s*\1\.?$/i);
  if (dup?.[1]?.trim()) return dup[1].trim();
  return cmd;
}

/** Text to rewrite — from "rephrase, ..." or "Hello... Make it more emotional." */
export function extractRephraseSourceText(command: string): string | null {
  const cmd = normalizeRephraseCommand(command);
  if (!isEditOrRephraseCommand(cmd)) return null;

  const makeThisText = cmd.match(
    /^(.+?)\s*[,]?\s*make\s+(?:this|that)\s+text\s+(?:more\s+)?/i,
  );
  if (makeThisText?.[1]?.trim()) {
    const body = makeThisText[1]
      .trim()
      .replace(TONE_SUFFIX, "")
      .replace(MAKE_THIS_TEXT_TONE, "")
      .trim();
    if (
      body.length >= 3 &&
      !/^(rephrase|rewrite|reword|revise|edit)$/i.test(body)
    ) {
      return body;
    }
  }

  const makeIt = cmd.match(/^(.+?)\s*[,]?\s*make\s+it\s+(?:more\s+)?/i);
  if (makeIt?.[1]?.trim()) {
    const body = makeIt[1].trim().replace(TONE_SUFFIX, "").trim();
    if (
      body.length >= 3 &&
      !/^(rephrase|rewrite|reword|revise|edit)$/i.test(body)
    ) {
      return body;
    }
  }

  const m = cmd.match(
    /^\s*(?:rephrase|rewrite|reword|revise|edit)\s*[,]?\s*(.+)$/i,
  );
  if (m?.[1]?.trim()) {
    const stripped = m[1].trim().replace(TONE_SUFFIX, "").replace(MAKE_IT_TONE, "").trim();
    if (stripped.length >= 3) return stripped;
  }

  return null;
}
