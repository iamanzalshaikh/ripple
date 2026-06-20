/**
 * P4 — Hinglish slot patterns for file operations (mein, naam, banao, inverted order).
 */

const LOC = "(downloads?|documents?|desktop)";

export function normalizeHinglishSlots(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");
  if (!s) return s;

  s = s.replace(
    new RegExp(
      `\\b(${LOC})\\s+mein\\s+(.+?)\\s+naam\\s+ka\\s+(folder|file)\\s+(?:bana[o]?|create)\\b`,
      "gi",
    ),
    "create $3 in $1, named $2",
  );

  s = s.replace(/\b(downloads?|documents?)\s+mein\b/gi, "in $1");
  s = s.replace(/\b(downloads?|documents?)\s+me\s+ma[in]?\b/gi, "in $1");
  s = s.replace(/\bdesktop\s+pe\b/gi, "in desktop");
  s = s.replace(/\bdesktop\s+par\b/gi, "in desktop");

  s = s.replace(/\bnaam\s+hai\s+/gi, "named ");
  s = s.replace(/\bnaam\s+/gi, "named ");
  s = s.replace(/\bjiska\s+naam\b/gi, "named");

  s = s.replace(/\bek\s+(folder|file)\b/gi, "a $1");
  s = s.replace(/\b(folder|file)\s+bana\s*do\b/gi, "create $1");
  s = s.replace(/\b(folder|file)\s+bana[o]?\b/gi, "create $1");
  s = s.replace(/\bcreate\s+karo\b/gi, "create");
  s = s.replace(/\bdelete\s+karo\b/gi, "delete");
  s = s.replace(/\bmove\s+karo\b/gi, "move");
  s = s.replace(/\brename\s+karo\b/gi, "rename");

  s = s.replace(/\b(folder|file)\s+create\b/gi, "create $1");
  s = s.replace(/\bcreate\s+(folder|file)\s+create\b/gi, "create $1");

  s = s.replace(
    new RegExp(
      `\\bin\\s+${LOC}\\s+create\\s+(folder|file)\\s+named\\s+(.+)`,
      "gi",
    ),
    "create $2 in $1, named $3",
  );

  s = s.replace(
    new RegExp(
      `\\bin\\s+${LOC}\\s+(folder|file)\\s+create\\s+named\\s+(.+)`,
      "gi",
    ),
    "create $2 in $1, named $3",
  );

  s = s.replace(
    new RegExp(
      `\\b(folder|file)\\s+bana[o]?\\s+(${LOC})\\s+mein\\s*,?\\s*naam\\s+(.+)`,
      "gi",
    ),
    "create $1 in $2, named $3",
  );

  s = s.replace(
    new RegExp(
      `\\b(${LOC})\\s+mein\\s+(folder|file)\\s+(?:bana[o]?|create)\\s*,?\\s*naam\\s+(.+)`,
      "gi",
    ),
    "create $2 in $1, named $3",
  );

  s = s.replace(
    new RegExp(
      `\\bcreate\\s+(folder|file)\\s+(${LOC})\\s+mein\\s*,?\\s*naam\\s+(.+)`,
      "gi",
    ),
    "create $1 in $2, named $3",
  );

  s = s.replace(/\bthen\s+(\w+)\s+open\b/gi, "then open $1");
  s = s.replace(/\bthen\s+(\w+)\s+kholo\b/gi, "then open $1");
  s = s.replace(/\bthen\s+mera\s+(\w+)\b/gi, "then open my $1");
  s = s.replace(/\bthen\s+my\s+(\w+)\b/gi, "then open my $1");

  s = s.replace(/^(.+?\.\w+)\s+delete\s*$/i, "delete $1");
  s = s.replace(/^(.+?)\s+delete\s*$/i, (_m, item: string) => {
    const t = item.trim();
    if (/^(create|rename|move|open)\b/i.test(t)) return `${t} delete`;
    return `delete ${t}`;
  });

  return s.replace(/\s{2,}/g, " ").trim();
}
