/**
 * Repair UTF-8 text that was mis-decoded (Hindi/Urdu STT + Windows code pages).
 */
import {
  containsArabicScript,
  containsDevanagari,
  containsSinhala,
  containsTamil,
} from "./scriptDetect.js";

function hasRegionalAfterRepair(text: string): boolean {
  return (
    containsDevanagari(text) ||
    containsArabicScript(text) ||
    containsSinhala(text) ||
    containsTamil(text)
  );
}

function isReadableLatinCommand(text: string): boolean {
  return /\b(open|create|delete|move|rename|folder|file|download|document|kholo|karo|banao)\b/i.test(
    text,
  );
}

/** Greek-alpha style: UTF-8 Hindi read as Latin-1. */
export function looksLikeUtf8Mojibake(text: string): boolean {
  if (!text || hasRegionalAfterRepair(text)) return false;
  return (
    /(?:à¤|à¥|Ã.|ã.|Â.|ï¿½|â€)/.test(text) ||
    /αñ/.test(text) ||
    /(?:\u03B1\u00F1){1,}/.test(text)
  );
}

/** Console / CP437 style: UTF-8 Arabic/Urdu shown as box-drawing chars. */
export function looksLikeBoxDrawingMojibake(text: string): boolean {
  if (!text || hasRegionalAfterRepair(text)) return false;
  const boxBlock = (text.match(/[\u2500-\u25FF]/g) ?? []).length;
  const legacyBox = (text.match(/[╪╣┘╛╝╗╔╚╩╦╠╣█¼½¾┐└┴┬├─┼╬╧╨╤╥╙╘╒╓╫╪╡╢╖╕╜╝╞╟╚╔╝╬╧]/g) ?? [])
    .length;
  const boxChars = boxBlock + legacyBox;
  return boxChars >= 3 || (boxChars > 0 && boxChars / text.length > 0.06);
}

export function looksLikeCorruptedRegionalEncoding(text: string): boolean {
  if (!text || hasRegionalAfterRepair(text)) return false;
  if (looksLikeUtf8Mojibake(text) || looksLikeBoxDrawingMojibake(text)) {
    return true;
  }
  const highBytes = (text.match(/[\u0080-\u024F]/g) ?? []).length;
  return (
    highBytes > text.length * 0.25 &&
    !isReadableLatinCommand(text) &&
    !/^[\x20-\x7E]+$/.test(text)
  );
}

/** IBM CP437 byte → Unicode (for reversing console mojibake). */
const CP437_UNICODE: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
  65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
  86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105,
  106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122,
  123, 124, 125, 126, 127, 199, 252, 233, 226, 228, 224, 229, 231, 234, 235, 232, 239,
  238, 236, 196, 197, 201, 230, 198, 244, 246, 242, 251, 249, 255, 214, 220, 162, 163,
  165, 8359, 402, 225, 237, 243, 250, 241, 209, 170, 186, 191, 8976, 172, 189, 188, 161,
  171, 187, 9617, 9618, 9619, 9474, 9508, 9569, 9570, 9558, 9557, 9571, 9553, 9559, 9565,
  9564, 9563, 9488, 9492, 9524, 9516, 9500, 9472, 9532, 9566, 9567, 9562, 9556, 9577, 9574,
  9568, 9552, 9580, 9575, 9576, 9572, 9573, 9561, 9560, 9554, 9555, 9579, 9578, 9496, 9484,
  9608, 9604, 9612, 9616, 9600, 945, 223, 915, 960, 931, 963, 181, 964, 934, 920, 937, 948,
  8734, 966, 949, 8745, 8801, 177, 8805, 8804, 8992, 8993, 247, 8776, 176, 8729, 183, 8730,
  8319, 178, 9632, 160,
];

let cp437Inverse: Map<string, number> | null = null;

function cp437InverseMap(): Map<string, number> {
  if (!cp437Inverse) {
    cp437Inverse = new Map();
    for (let b = 0; b < 256; b++) {
      const ch = String.fromCodePoint(CP437_UNICODE[b]!);
      if (!cp437Inverse.has(ch)) cp437Inverse.set(ch, b);
    }
  }
  return cp437Inverse;
}

/** UTF-8 Urdu/Hindi misread as Windows CP437 (box-drawing in logs). */
export function repairCp437Utf8Mojibake(text: string): string {
  if (!text) return text;
  const inv = cp437InverseMap();
  const bytes: number[] = [];
  for (const ch of text) {
    const b = inv.get(ch);
    if (b !== undefined) bytes.push(b);
    else if (ch.charCodeAt(0) < 128) bytes.push(ch.charCodeAt(0));
  }
  if (bytes.length === 0) return text;
  try {
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return text;
  }
}

function byteRoundtripCandidates(text: string): string[] {
  const out: string[] = [];
  if (looksLikeBoxDrawingMojibake(text)) {
    out.push(repairCp437Utf8Mojibake(text));
  }
  try {
    out.push(Buffer.from(text, "latin1").toString("utf8"));
  } catch {
    /* ignore */
  }
  try {
    const buf = Buffer.alloc(text.length);
    for (let i = 0; i < text.length; i++) {
      buf[i] = text.charCodeAt(i) & 0xff;
    }
    out.push(buf.toString("utf8"));
  } catch {
    /* ignore */
  }
  return out;
}

function scoreRepairCandidate(original: string, candidate: string): number {
  if (!candidate || candidate === original) return 0;
  let score = 0;
  if (hasRegionalAfterRepair(candidate)) score += 10;
  if (isReadableLatinCommand(candidate)) score += 8;
  if (containsArabicScript(candidate) || containsDevanagari(candidate)) {
    score += 6;
  }
  const replacement = (candidate.match(/\uFFFD/g) ?? []).length;
  score -= replacement * 3;
  const printable = (candidate.match(/[\p{L}\p{N}\s.,'-]/gu) ?? []).length;
  score += printable / Math.max(candidate.length, 1);
  return score;
}

/** Best-effort repair for Hindi/Urdu mojibake before NLU parsers run. */
export function repairCorruptedTranscript(text: string): string {
  if (!text?.trim()) return text;

  if (hasRegionalAfterRepair(text) && isReadableLatinCommand(text)) {
    return text;
  }

  if (!looksLikeCorruptedRegionalEncoding(text)) {
    return text;
  }

  if (/[\u2500-\u25FF]/.test(text)) {
    const cp437 = repairCp437Utf8Mojibake(text);
    if (containsArabicScript(cp437) || containsDevanagari(cp437)) {
      return cp437;
    }
    if (/\b(search|find|play|watch|open|season|episode)\b/i.test(cp437)) {
      return cp437;
    }
  }

  if (looksLikeBoxDrawingMojibake(text)) {
    const cp437 = repairCp437Utf8Mojibake(text);
    if (containsArabicScript(cp437) || containsDevanagari(cp437)) {
      return cp437;
    }
  }

  let best = text;
  let bestScore = scoreRepairCandidate(text, text);

  for (const candidate of byteRoundtripCandidates(text)) {
    if (containsArabicScript(candidate) || containsDevanagari(candidate)) {
      return candidate;
    }
    const score = scoreRepairCandidate(text, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (looksLikeBoxDrawingMojibake(text) && best !== text && bestScore > 0) {
    return best;
  }

  if (looksLikeUtf8Mojibake(text) && best !== text) {
    if (containsDevanagari(best) || containsArabicScript(best) || bestScore > 1) {
      return best;
    }
  }

  if (bestScore > 2) {
    return best;
  }

  return text;
}

export function repairUtf8Mojibake(text: string): string {
  return repairCorruptedTranscript(text);
}
export function repairMixedDesktopOpen(text: string): string {
  const s = text.trim();
  if (!/^desktop\b/i.test(s)) return s;

  if (hasRegionalAfterRepair(s)) {
    if (/\bखोल|करो|खोलो|khol|kholo|karo\b/i.test(s)) {
      return "open desktop";
    }
  }

  if (
    looksLikeCorruptedRegionalEncoding(s) ||
    /[^\x00-\x7F]/.test(s.replace(/^desktop\s*/i, ""))
  ) {
    return "open desktop";
  }

  if (/^desktop\s+(?:kholo|khol\s*do|open\s*karo|karo)$/i.test(s)) {
    return "open desktop";
  }

  return s;
}
