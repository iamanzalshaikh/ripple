import type { DesktopOpenIntent, WellKnownFolder } from "./parseDesktopCommand.js";

const FOLDER_ALIASES: Record<string, WellKnownFolder> = {
  download: "downloads",
  downloads: "downloads",
  document: "documents",
  documents: "documents",
  desktop: "desktop",
};

/** Map spoken token to a well-known user folder (not a arbitrary file name). */
export function normalizeFolderKey(raw: string): WellKnownFolder | null {
  let key = raw.trim().toLowerCase().replace(/['"]/g, "");
  key = key.replace(/\s+(?:for\s+me|please|folder)\s*$/gi, "").trim();
  const first = key.split(/\s+/)[0] ?? key;
  return FOLDER_ALIASES[first] ?? FOLDER_ALIASES[key] ?? null;
}

const POLITE_TAIL = /(?:\s+(?:for\s+me|please|thanks|thank\s+you|folder))+$/i;
const LEADING_FILLER =
  /^(?:bhai|yaar|yar|dude|bro|arre|arey|sun|sunno|dekho|please|plz)\s+/i;

/**
 * Intent: user wants Downloads / Documents / Desktop — not a file named "desktop for me".
 * Handles scrambled Whisper order and polite suffixes.
 */
export function parseWellKnownFolderOpen(
  command: string,
): DesktopOpenIntent | null {
  let cmd = command.trim();
  for (let i = 0; i < 4; i++) {
    const next = cmd.replace(LEADING_FILLER, "");
    if (next === cmd) break;
    cmd = next;
  }
  cmd = cmd.replace(POLITE_TAIL, "").trim();
  if (!cmd) return null;

  // "Download open" / "Downloads open for me"
  const scrambled = cmd.match(
    /^\s*(downloads?|documents?|desktop)\s+open\s*$/i,
  );
  if (scrambled?.[1]) {
    const folder = normalizeFolderKey(scrambled[1]);
    if (folder) return { kind: "folder", folder };
  }

  // "Open downloads" / "Open my desktop for me" / "Open the documents folder"
  const openFolder = cmd.match(
    /^\s*open\s+(?:the\s+)?(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
  );
  if (openFolder?.[1]) {
    const folder = normalizeFolderKey(openFolder[1]);
    if (folder) return { kind: "folder", folder };
  }

  // "Show me downloads" / "Go to my documents" (after NLU normalize → open)
  const showFolder = cmd.match(
    /^\s*(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
  );
  if (showFolder?.[1]) {
    const folder = normalizeFolderKey(showFolder[1]);
    if (folder) return { kind: "folder", folder };
  }

  return null;
}

/** If open target is really a well-known folder with polite noise, return folder intent. */
export function folderIntentFromOpenTarget(spoken: string): DesktopOpenIntent | null {
  const folder = normalizeFolderKey(spoken);
  if (folder) return { kind: "folder", folder };
  return null;
}
