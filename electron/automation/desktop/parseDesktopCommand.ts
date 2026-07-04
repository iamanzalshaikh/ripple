import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import {
  folderIntentFromOpenTarget,
  normalizeFolderKey,
  parseWellKnownFolderOpen,
} from "./folderIntent.js";
import { hasCompoundTailAfterFirstClause, COMPOUND_CLAUSE_VERBS } from "../voice/nlu/compoundParse.js";

const COMPOUND_TAIL_IN_ITEM = new RegExp(
  `,\\s*(?=(?:${COMPOUND_CLAUSE_VERBS})\\b)`,
  "i",
);

export type WellKnownFolder = "downloads" | "documents" | "desktop";

export type DesktopOpenIntent =
  | { kind: "folder"; folder: WellKnownFolder }
  | { kind: "file"; filename: string }
  | { kind: "item"; name: string; parent?: WellKnownFolder };

/** Web/app opens — never treat as desktop folder/file. */
const WEB_OR_APP_OPEN =
  /\bopen\s+(?:the\s+)?(?:app\s+)?(gmail|google\s*mail|whatsapp|notion|youtube|linkedin|instagram|chrome|firefox|edge|browser|slack|discord|spotify|facebook|twitter|mail|email)\b/i;

/** Gmail sender/subject search — handled by open_gmail_email intent. */
const GMAIL_EMAIL_FROM =
  /^\s*open\s+(?:a\s+|an\s+|the\s+)?(?:mail|email)s?\s+from\s+/i;

const GMAIL_EMAIL_SUBJECT =
  /^\s*open\s+(?:the\s+|a\s+|an\s+)?(?:(?:mail|email)s?\s+(?:about|on|regarding|with\s+subject)\s+|.+?\s+(?:mail|email)s?\s*)$/i;

const GMAIL_ATTACHMENT =
  /^\s*open\s+.*\b(?:gmail|mail|email)\b.*\b(?:attachment|attached|attach|thread)\b/i;

const ITEM_IN_FOLDER =
  /^\s*open\s+(?:my\s+)?(.+?)\s+(?:in|on)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*\.?\s*$/i;

const FOLDER_IN_LOCATION =
  /^\s*open\s+folder\s+(.+?)\s+(?:in|on)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*\.?\s*$/i;

/**
 * Parse desktop-only voice commands:
 * - "Open Downloads" / "Open desktop for me"
 * - "Download open for me" (scrambled)
 * - "Open Flow in desktop" / "Open Eric" (search)
 */
export function parseDesktopCommand(command?: string | null): DesktopOpenIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (
    !cmd ||
    WEB_OR_APP_OPEN.test(cmd) ||
    GMAIL_EMAIL_FROM.test(cmd) ||
    GMAIL_EMAIL_SUBJECT.test(cmd) ||
    GMAIL_ATTACHMENT.test(cmd)
  ) {
    return null;
  }

  const folderIntent = parseWellKnownFolderOpen(cmd);
  if (folderIntent) return folderIntent;

  const folderInLocation = cmd.match(FOLDER_IN_LOCATION);
  if (folderInLocation?.[1] && folderInLocation[2]) {
    const folder = normalizeFolderKey(folderInLocation[2]);
    if (folder) {
      return {
        kind: "item",
        name: folderInLocation[1].trim(),
        parent: folder,
      };
    }
  }

  const itemInFolder = cmd.match(ITEM_IN_FOLDER);
  if (itemInFolder?.[1] && itemInFolder[2]) {
    const folder = normalizeFolderKey(itemInFolder[2]);
    if (folder) {
      let name = itemInFolder[1].trim();
      if (/^folder\s+/i.test(name)) {
        name = name.replace(/^folder\s+/i, "").trim();
      }
      return {
        kind: "item",
        name,
        parent: folder,
      };
    }
  }

  const fileExplicit = cmd.match(
    /^\s*open\s+(?:the\s+)?file\s+(.+?)\s*\.?\s*$/i,
  );
  if (fileExplicit?.[1]?.trim()) {
    return { kind: "file", filename: fileExplicit[1].trim() };
  }

  const fileWithExt = cmd.match(
    /^\s*open\s+(?:the\s+)?([^\s]+\.[a-z0-9]{2,8})\s*\.?\s*$/i,
  );
  if (fileWithExt?.[1]?.trim()) {
    return { kind: "file", filename: fileWithExt[1].trim() };
  }

  const openItem = cmd.match(/^\s*open\s+(?:my\s+)?(.+?)\s*\.?\s*$/i);
  if (openItem?.[1]?.trim()) {
    const name = openItem[1].trim();
    if (hasCompoundTailAfterFirstClause(name) || COMPOUND_TAIL_IN_ITEM.test(name)) {
      return null;
    }
    if (/^(?:today|yesterday|tomorrow)'?s?\s+pdf$/i.test(name)) {
      return null;
    }
    const asFolder = folderIntentFromOpenTarget(name);
    if (asFolder) return asFolder;
    if (!normalizeFolderKey(name)) {
      return { kind: "item", name };
    }
  }

  return null;
}

export function isDesktopOpenCommand(command?: string | null): boolean {
  return parseDesktopCommand(command) !== null;
}

export { normalizeFolderKey, parseWellKnownFolderOpen };
