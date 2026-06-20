/**
 * Phase 4.6 — strip conversational filler and map casual verbs to canonical commands.
 */
const LEADING_FILLER =
  /^(?:hey\s+ripple|ripple|okay|ok|yeah|yep|yes|yup|um+|uh+|well|so|like|please|kindly|just|actually|basically|honestly)\s+/i;

const POLITENESS_PREFIX =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+|kindly\s+)?|I\s+(?:want|need|wanna|would\s+like)\s+to\s+|go\s+ahead\s+and\s+|let'?s\s+)/i;

function stripLeadingFillers(s: string): string {
  let out = s;
  for (let i = 0; i < 6; i++) {
    const next = out.replace(LEADING_FILLER, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

export function normalizeForNlu(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");

  const recallProtected =
    /^\s*(?:open\s+)?(?:it|that)\s+again\s*$/i.test(s) ||
    /^\s*bring\s+(?:it|that)\s+back\s*$/i.test(s) ||
    /^\s*same\s+(?:file|folder|thing|one)\s+again\s*$/i.test(s) ||
    /^\s*go\s+back\s*$/i.test(s) ||
    /^\s*(?:that|the)\s+(?:file|folder|project)\s+again\s*$/i.test(s) ||
    /^\s*open\s+(?:that|the)\s+project\s*$/i.test(s);

  if (!recallProtected) {
    s = stripLeadingFillers(s);
    s = s.replace(POLITENESS_PREFIX, "");
    s = stripLeadingFillers(s);

    // Trailing politeness / filler
    s = s.replace(
      /\s+(?:please|thanks|thank\s+you|for\s+me|right\s+now|real\s+quick|if\s+you\s+can|okay|ok)\s*$/gi,
      "",
    );

    // Whisper: "upon download" mishearing for "open download"
    s = s.replace(
      /\bupon\s+(?:the\s+)?(?:my\s+)?(downloads?|documents?|desktop)\b/gi,
      "open $1",
    );

    // Casual verbs → open (skip recall phrases like "bring it back")
    s = s.replace(
      /\b(show\s+me|pull\s+up|bring\s+up|get\s+me|let\s+me\s+see|display|navigate\s+to|go\s+to|head\s+to|take\s+me\s+to|jump\s+to)\b/gi,
      "open",
    );
  } else {
    s = stripLeadingFillers(s);
  }

  if (!recallProtected) {
    // Find/get → open (desktop file context)
    s = s.replace(
      /\b(find|grab|locate)\s+(?:and\s+open\s+)?(?:my\s+)?/gi,
      "open my ",
    );

    // Close / launch casual
    s = s.replace(
      /\b(shut\s+down|kill|get\s+rid\s+of|close\s+out)\s+(?:the\s+)?(?:app\s+)?/gi,
      "close ",
    );
    s = s.replace(/\b(fire\s+up|boot\s+up|spin\s+up)\b/gi, "launch");

    // Switch / focus casual
    s = s.replace(
      /\b(switch\s+back\s+to|go\s+back\s+to|flip\s+to)\s+(?:the\s+)?(?:app\s+)?/gi,
      "switch to ",
    );

    // Folder phrasing + singular "download" / "document"
    s = s.replace(/\b(?:my\s+)?downloads?\s+folder\b/gi, "downloads");
    s = s.replace(/\b(?:my\s+)?documents?\s+folder\b/gi, "documents");
    s = s.replace(/\b(?:my\s+)?desktop\s+folder\b/gi, "desktop");

    // Location hints: "on my desktop" → "in desktop"
    s = s.replace(
      /\b(?:on|from)\s+(?:my\s+)?(downloads?|documents?|desktop)\b/gi,
      "in $1",
    );

    // "open up X" → "open X"
    s = s.replace(/\bopen\s+up\b/gi, "open");

    // Lock casual
    s = s.replace(
      /\b(lock\s+(?:my\s+)?(?:pc|computer|machine|screen|laptop))\b/gi,
      "lock my computer",
    );

    s = stripLeadingFillers(s);
  }

  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  return s.trim();
}
