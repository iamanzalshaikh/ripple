/** Shared parsing for delete/rename/move — item name vs folder location. */

/**
 * Absolute Windows path as a location. Allows spaces in folder names
 * ("C:\Users\…\Test 2") but stops before trailing punctuation.
 * Drive root forms: "C:\" and "C:\\".
 */
const ABS_PATH_LOCATION = "[a-zA-Z]:\\\\(?:[^\\\\/:*?\"<>|\\r\\n]+\\\\)*[^\\\\/:*?\"<>|\\r\\n]*";
const LOC_SUFFIX = new RegExp(
  `\\s+(?:from|in|inside)\\s+(?:my\\s+|the\\s+)?(downloads?|documents?|desktop|${ABS_PATH_LOCATION})\\s*\\.?\\s*$`,
  "i",
);

/**
 * Location words used to collapse to a hardcoded "desktop" default for
 * anything that wasn't literally "downloads/documents/desktop" — silently
 * discarding a real absolute path the caller explicitly said (wave0 T2-T5:
 * "create a folder called X inside C:\Ripple-Test\W0" landed on Desktop
 * with a garbage name instead). A real absolute path now passes through
 * unchanged; resolveParentPath/resolveDestinationDir already handle that.
 */
export function parseParentKey(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-zA-Z]:\\/.test(trimmed)) return trimmed;
  const key = trimmed.toLowerCase();
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
