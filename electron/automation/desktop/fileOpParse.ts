/** Shared parsing for delete/rename/move — item name vs folder location. */

const LOC_SUFFIX =
  /\s+(?:from|in|inside)\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop)\s*\.?\s*$/i;

export function parseParentKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key.startsWith("download")) return "downloads";
  if (key.startsWith("document")) return "documents";
  return "desktop";
}

/** Whisper sometimes repeats: "Delete X. Delete X from downloads." — use the clearer clause. */
export function takePrimaryFileOpCommand(cmd: string): string {
  const parts = cmd
    .split(/\.\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return cmd.trim();

  const withLocation = parts.filter((p) => LOC_SUFFIX.test(p));
  if (withLocation.length > 0) {
    return withLocation[withLocation.length - 1]!;
  }

  const last = parts[parts.length - 1]!;
  if (/^(delete|rename|move|create)\b/i.test(last)) return last;
  return parts[0]!;
}

export function stripItemFiller(name: string): string {
  return name
    .replace(/^(?:the\s+)?(?:named|called)\s+/i, "")
    .replace(/^(?:folder|file)\s+(?:named|called)\s+/i, "")
    .replace(/^(?:folder|file)\s+/i, "")
    .replace(/\s+(?:folder|file)\s*$/i, "")
    .trim();
}

export function splitItemAndLocation(
  text: string,
): { item: string; parent?: string } {
  const match = text.match(LOC_SUFFIX);
  if (!match?.[1] || match.index === undefined) {
    return { item: stripItemFiller(text) };
  }

  const rawItem = text.slice(0, match.index).trim();
  return {
    item: stripItemFiller(rawItem),
    parent: parseParentKey(match[1]),
  };
}

export function parseLocationSuffix(cmd: string): {
  body: string;
  parent?: string;
} {
  const match = cmd.match(LOC_SUFFIX);
  if (!match?.[1] || match.index === undefined) {
    return { body: cmd.trim() };
  }

  return {
    body: cmd.slice(0, match.index).trim(),
    parent: parseParentKey(match[1]),
  };
}
