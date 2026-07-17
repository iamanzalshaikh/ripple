/**
 * Post-Whisper cleanup — not a replacement for STT.
 */
import {
  repairCorruptedTranscript,
  repairMixedDesktopOpen,
} from "./i18n/repairEncoding.js";

export function normalizeTranscript(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");
  const beforeRepair = s;
  s = repairCorruptedTranscript(s);
  if (s !== beforeRepair) {
    console.info(
      `[ripple-desktop] transcript encoding repaired (${beforeRepair.length} → ${s.length} chars)`,
    );
  }
  s = repairMixedDesktopOpen(s);

  // Whisper pause commas (not list separators): "Remember, work mode, open X"
  s = s.replace(/^(remember|forget|remove|start|run|launch|list|show|opens?)\s*,\s*/i, "$1 ");
  s = s.replace(/^member\s+work\s+mode\b/i, "Remember work mode");
  s = s.replace(/^member\s+/i, "Remember ");
  s = s.replace(/^opens\s+/i, "open ");
  s = s.replace(/\bopen\s+(?:the\s+)?downloads?\s+folder\b/gi, "open downloads");
  s = s.replace(/\bopen\s+(?:the\s+)?documents?\s+folder\b/gi, "open documents");
  s = s.replace(/\b(open\s+it\s+again)(?:\s+\1)+\b/gi, "$1");
  s = s.replace(/\b(open\s+same\s+file\s+again)(?:\s+\1)+\b/gi, "$1");
  s = s.replace(/^(forget|remove)\s+workflow\s*,\s*/i, "$1 workflow ");
  s = s.replace(/,\s*open\s+/gi, " open ");
  s = s.replace(/\bremember\s+(?:my\s+)?([^,]+?)\s*,\s*open\b/gi, "remember $1 open");

  // Whisper singular: "Open setting" → "Open settings"
  s = s.replace(/\bopen\s+(?:windows\s+)?setting\b/gi, "open settings");
  s = s.replace(/\bopen\s+(?:the\s+)?system\s+setting\b/gi, "open system settings");
  s = s.replace(/\bopen\s+(?:the\s+)?bluetooth\s+setting\b/gi, "open bluetooth settings");
  s = s.replace(
    /\bopen\s+(?:the\s+)?network\s+setting\b/gi,
    "open network settings",
  );
  s = s.replace(/\bopen\s+(?:the\s+)?wifi\s+setting\b/gi, "open wifi settings");
  s = s.replace(/\bopen\s+(?:the\s+)?wi-?fi\s+setting\b/gi, "open wifi settings");

  // Whisper pause commas: "Move, flow to, downloads"
  s = s.replace(/^(move|rename|delete)\s*,\s*/i, "$1 ");
  s = s.replace(/\bto\s*,\s*/gi, "to ");
  s = s.replace(/,\s+to\s+/gi, " to ");

  // "Create folder, name user in Downloads" → "Create folder named user in Downloads"
  s = s.replace(
    /\bcreate\s+folder\s*,\s*name\s+/gi,
    "create folder named ",
  );
  s = s.replace(
    /\bcreate\s+(?:a\s+)?folder\s+name\s+/gi,
    "create folder named ",
  );

  s = s.replace(/\s+and\s+text\s+/gi, " and say ");
  s = s.replace(/\bsaaliq\b/gi, "Saaliq");
  s = s.replace(/\bwhats\s*app\b/gi, "WhatsApp");
  // Common Whisper mishearings for contact names
  s = s.replace(/\bsearch\s+me\s+one\b/gi, "search Ammi1");
  s = s.replace(/\bsearch\s+ami\s+one\b/gi, "search Ammi1");
  s = s.replace(/\bsearch\s+ammi\s+1\b/gi, "search Ammi1");
  s = s.replace(/\bsearch\s+a\s+me\s+1\b/gi, "search Ammi1");
  s = s.replace(/\babhishek\s+vark\b/gi, "Abhishek");
  s = s.replace(/\babhishek\s+dwork\b/gi, "Abhishek");
  s = s.replace(/\bgoodnight\b/gi, "good night");

  // Whisper glues "Open" + filename: "OpenResume.pdf" -> "Open Resume.pdf"
  s = s.replace(/\bopen([A-Za-z0-9][^\s]*\.\w{2,8})\b/gi, "open $1");

  // "server.jsin cursor" → "server.js in cursor" (filename glued to "in")
  s = s.replace(
    /(\.[a-z0-9]{1,12})(in|inside)\s+(cursor|notepad|word|vs\s*code)\b/gi,
    "$1 in $3",
  );

  // Whisper mishearings — desktop folders
  s = s.replace(/\bupon\s+(?:the\s+)?(?:my\s+)?downloads?\b/gi, "open downloads");
  s = s.replace(/\bupon\s+(?:the\s+)?(?:my\s+)?documents?\b/gi, "open documents");
  s = s.replace(/\bforme\b/gi, "for me");
  s = s.replace(/\bopen\s+download\b/gi, "open downloads");
  s = s.replace(/\bopen\s+document\b/gi, "open documents");
  s = s.replace(
    /\b(?:last|latest|most\s+recent)\s+downloads?\s+file\b/gi,
    "last downloaded file",
  );

  // SAPI / Whisper mishear Hinglish "kholo" as "kolo" / "colo"
  const kholoMishear = "[ck][o0]l[o0]";
  s = s.replace(
    new RegExp(`^\\s*download\\s+${kholoMishear}\\s*$`, "i"),
    "Open downloads",
  );
  s = s.replace(
    new RegExp(`^\\s*downloads?\\s+${kholoMishear}\\s*$`, "i"),
    "Open downloads",
  );
  s = s.replace(
    new RegExp(
      `\\b(?:mera|mara)\\s+resume(?:\\s+(?:${kholoMishear}|kholo|khol\\s*do))?\\b`,
      "gi",
    ),
    "open my resume",
  );
  s = s.replace(
    new RegExp(`\\bopen\\s+my\\s+resume\\s+${kholoMishear}\\b`, "gi"),
    "open my resume",
  );
  s = s.replace(/\bmessage\s+nor\b/gi, "Message Noor");

  // Scrambled order: "Download open for me" → "Open downloads"
  s = s.replace(
    /^\s*(downloads?|documents?|desktop)\s+open(?:\s+for\s+me)?\s*$/i,
    (_, folder: string) => {
      const key = folder.toLowerCase();
      if (key.startsWith("download")) return "Open downloads";
      if (key.startsWith("document")) return "Open documents";
      return "Open desktop";
    },
  );

  // "Open desktop for me" → "Open desktop" (intent = folder, not file search)
  s = s.replace(
    /^\s*open\s+(?:the\s+)?(?:my\s+)?(downloads?|documents?|desktop)\s+for\s+me\s*$/i,
    (_, folder: string) => {
      const key = folder.toLowerCase();
      if (key.startsWith("download")) return "Open downloads";
      if (key.startsWith("document")) return "Open documents";
      return "Open desktop";
    },
  );

  // Whisper glues "naam B2" → naamB2 (breaks Hinglish slot patterns; not "named")
  s = s.replace(/\bnaam([A-Z0-9][A-Za-z0-9]*)\b/g, "naam $1");

  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Trailing punctuation breaks phrase parsers (e.g. "... on YouTube.")
  s = s.replace(/[.,!?;:]+$/g, "").trim();
  // Voice filler: "Make it emotional. Do it" → "Make it emotional"
  s = s.replace(/\s+\b(?:do\s+it|go\s+ahead|please)\s*$/i, "").trim();
  // "saying, how are you" → "saying how are you" (voice comma after saying)
  s = s.replace(/\b(saying|ask)\s*,\s*/gi, "$1 ");

  return s;
}

export function normalizeContactToken(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
