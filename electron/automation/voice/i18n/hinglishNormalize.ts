/**
 * Phase 4.7 — fix Hinglish / Roman Hindi surface forms before English parsers.
 */

const FILE_OP_NAAM_KA: [RegExp, string][] = [
  [
    /\b(downloads?|documents?|desktop)\s+mein\s+(.+?)\s+naam\s+ka\s+(folder|file)\s+bana[o]?/gi,
    "create $3 in $1, named $2",
  ],
  [
    /\b(downloads?|documents?|desktop)\s+mein\s+(folder|file)\s+bana[o]?\s*,?\s*naam\s+(.+)/gi,
    "create $2 in $1, named $3",
  ],
];

const LEADING_FILLER_HI =
  /^(?:bhai|yaar|yar|dude|bro|arre|arey|sun|sunno|dekho|please|plz)\s+/i;

const TRAILING_FILLER_HI =
  /\s+(?:na|yaar|bhai|please|plz|kar\s*do|kardo|kr\s*do|kijiye|kijye)\s*$/i;

/** Folder + verb patterns — must run BEFORE generic verb/folder maps. */
const FOLDER_VERB_PATTERNS: [RegExp, string][] = [
  [
    /\b(downloads?|documents?|desktop)\s+(?:ko\s+)?(?:kholo|khol\s*do|open|karo|kar\s*do)\b/gi,
    "open $1",
  ],
  [
    /\b(?:kholo|khol\s*do|karo|kar\s*do)\s+(?:mera\s+|my\s+)?(downloads?|documents?|desktop)\b/gi,
    "open $1",
  ],
  [/\b(downloads?)\s+karo\b/gi, "open $1"],
  [/\bdesktop\s+kholo\b/gi, "open desktop"],
  [/\bdesktop\s+khol\s*do\b/gi, "open desktop"],
  [/\b(downloads?)\s+kar\s*do\b/gi, "open $1"],
  [/\bwhats?\s*app\s+(?:kholo|khol\s*do|open|karo)\b/gi, "open whatsapp"],
  [/\b(?:kholo|open)\s+whats?\s*app\b/gi, "open whatsapp"],
];

const VERB_MAP: [RegExp, string][] = [
  [/\bkholo\b/gi, "open"],
  [/\bkhol\s*do\b/gi, "open"],
  [/\bdikhao\b/gi, "show"],
  [/\bdikha\s*do\b/gi, "show"],
  [/\bbhej\s*do\b/gi, "send"],
  [/\bbhejo\b/gi, "send"],
  [/\bhata\s*do\b/gi, "delete"],
  [/\bmita\s*do\b/gi, "delete"],
  [/\bdelete\s*kar\s*do\b/gi, "delete"],
  [/\bmove\s*kar\s*do\b/gi, "move"],
  [/\brename\s*kar\s*do\b/gi, "rename"],
  [/\bbana\s*do\b/gi, "create"],
  [/\bbanao\b/gi, "create"],
  [/\blaunch\s*kar\s*do\b/gi, "launch"],
  [/\bopen\s*kar\s*do\b/gi, "open"],
  [/\bchalu\s*kar\s*do\b/gi, "launch"],
  [/\bband\s*kar\s*do\b/gi, "close"],
  [/\bband\s*karo\b/gi, "close"],
  [/\bmessage\s+kar\s*do\b/gi, "message"],
  [/\bmsg\s+kar\s*do\b/gi, "message"],
];

const POSSESSIVE_MAP: [RegExp, string][] = [
  [/\bmera\b/gi, "my"],
  [/\bmeri\b/gi, "my"],
  [/\bmere\b/gi, "my"],
  [/\bmeraa\b/gi, "my"],
  [/\bhamara\b/gi, "my"],
  [/\bhamari\b/gi, "my"],
];

const TIME_MAP: [RegExp, string][] = [
  [/\bkal\s+ki\b/gi, "yesterday's"],
  [/\bkal\s+wali\b/gi, "yesterday's"],
  [/\bkal\s+ka\b/gi, "yesterday's"],
  [/\bkal\b/gi, "yesterday"],
  [/\baaj\s+ki\b/gi, "today's"],
  [/\baaj\s+wali\b/gi, "today's"],
  [/\baaj\b/gi, "today"],
  [/\bparso\b/gi, "day before yesterday"],
];

/** Word-boundary only — no trailing \\s* (was merging "download open" → "downloadsopen"). */
const FOLDER_MAP: [RegExp, string][] = [
  [/\bdownloads?\b/gi, "downloads"],
  [/\bdocuments?\b/gi, "documents"],
  [/\bdesktop\b/gi, "desktop"],
];

/** Do not rewrite folder words inside name slots or smart-search phrases. */
function applyFolderMap(s: string): string {
  const protectedPhrase = s.replace(
    /\blast\s+downloads?(?:ed)?(?:\s+file)?\b/gi,
    "last downloaded file",
  );
  const marker = protectedPhrase.search(/\b(?:named|called|name)\s+(?=[A-Za-z0-9])/i);
  if (marker === -1) {
    let out = protectedPhrase;
    for (const [re, rep] of FOLDER_MAP) out = out.replace(re, rep);
    return out;
  }
  let head = protectedPhrase.slice(0, marker);
  const tail = protectedPhrase.slice(marker);
  for (const [re, rep] of FOLDER_MAP) head = head.replace(re, rep);
  return head + tail;
}

const PRONOUN_MAP: [RegExp, string][] = [
  [/\bwoh\b/gi, "that"],
  [/\bwo\b/gi, "that"],
  [/\busko\b/gi, "it"],
  [/\buse\b/gi, "it"],
  [/\bissey\b/gi, "it"],
  [/\bis\s*ko\b/gi, "it"],
  [/\bdubara\b/gi, "again"],
  [/\bphir\s*se\b/gi, "again"],
];

const CONJUNCTION_MAP: [RegExp, string][] = [
  [/\s+aur\s+/gi, " and "],
  [/\s+phir\s+/gi, " then "],
];

/** Recall — must run before verb/pronoun maps turn "dubara kholo" → "again open". */
const RECALL_PHRASES: [RegExp, string][] = [
  [/^\s*dubara\s+kholo\s*$/i, "open it again"],
  [/^\s*phir\s+se\s+(?:kholo|open)(?:\s+karo)?\s*$/i, "open it again"],
  [/^\s*woh\s+project\s+kholo\s*$/i, "open that project"],
  [/^\s*that\s+project\s+open\s*$/i, "open that project"],
  [/^\s*again\s+open\s*$/i, "open it again"],
  [/^\s*open\s+again\s*$/i, "open it again"],
];

function fixInvertedOpenFolder(s: string): string {
  return s
    .replace(
      /\bopen\s+(downloads?|documents?|desktop)\s+open\b/gi,
      "open $1",
    )
    .replace(
      /\b(downloads?|documents?|desktop)\s+open\b/gi,
      "open $1",
    )
    .replace(/\bdownloadsopen\b/gi, "open downloads")
    .replace(/\bdocumentsopen\b/gi, "open documents")
    .replace(/\bdesktopopen\b/gi, "open desktop")
    .replace(/\bopen\s+\$2\b/gi, "open downloads")
    .replace(/\bopen\s+\$1\b/gi, "open downloads");
}

export function normalizeHinglish(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");
  if (!s) return s;

  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEADING_FILLER_HI, "");
    if (next === s) break;
    s = next;
  }

  for (const [re, rep] of CONJUNCTION_MAP) s = s.replace(re, rep);
  for (const [re, rep] of RECALL_PHRASES) s = s.replace(re, rep);
  for (const [re, rep] of FILE_OP_NAAM_KA) s = s.replace(re, rep);
  for (const [re, rep] of FOLDER_VERB_PATTERNS) s = s.replace(re, rep);
  for (const [re, rep] of POSSESSIVE_MAP) s = s.replace(re, rep);
  for (const [re, rep] of TIME_MAP) s = s.replace(re, rep);
  for (const [re, rep] of VERB_MAP) s = s.replace(re, rep);
  s = applyFolderMap(s);
  for (const [re, rep] of PRONOUN_MAP) s = s.replace(re, rep);

  s = s.replace(TRAILING_FILLER_HI, "");
  s = s.replace(/\s+karo\s*$/i, "");
  s = s.replace(/\s+do\s*$/i, "");

  s = fixInvertedOpenFolder(s);
  s = s.replace(/\bopen\s+open\s+/gi, "open ");
  s = s.replace(/\bopen\s+my\s+resume\s+open\b/gi, "open my resume");

  // "VS Code open" / "Chrome kholo" → "open VS Code" (skip compound "then …" clauses)
  if (!/\bthen\b/i.test(s)) {
    s = s.replace(
      /^(.+?)\s+open\s*$/i,
      (_m, name: string) => {
        const n = name.trim();
        if (/^(downloads?|documents?|desktop|my|yesterday|again)$/i.test(n)) {
          if (/^again$/i.test(n)) return "open it again";
          return `${n} open`;
        }
        return `open ${n}`;
      },
    );
  }

  s = s.replace(/^(.+?)\s+close\s*$/i, (_m, name: string) => `close ${name.trim()}`);
  s = s.replace(/^(.+?)\s+launch\s*$/i, (_m, name: string) => `open ${name.trim()}`);

  s = s.replace(/^\s*dubara\s+open\s*$/i, "open it again");
  s = s.replace(/^\s*phir\s+se\s+open\s*$/i, "open it again");
  s = s.replace(/^\s*again\s+open\s*$/i, "open it again");
  s = s.replace(/^\s*dubara\s+kholo\s*$/i, "open it again");
  s = s.replace(/^\s*phir\s+se\s+kholo\s*$/i, "open it again");

  s = s.replace(/\bshow\s+my\b/gi, "open my");
  s = s.replace(/\bshow\s+my\s+resume\b/gi, "open my resume");
  s = s.replace(/\bmy\s+resume\s+show\b/gi, "open my resume");
  s = s.replace(/\bshow\s+yesterday\b/gi, "open yesterday");
  s = s.replace(/\bshow\s+that\b/gi, "open that");

  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  return s.trim();
}
