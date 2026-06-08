import { normalizeTranscript } from "../voice/normalizeTranscript.js";

export type WellKnownFolder = "downloads" | "documents" | "desktop";

export type DesktopOpenIntent =
  | { kind: "folder"; folder: WellKnownFolder }
  | { kind: "file"; filename: string };

/** Web/app opens — never treat as desktop folder/file. */
const WEB_OR_APP_OPEN =
  /\bopen\s+(?:the\s+)?(?:app\s+)?(gmail|google\s*mail|whatsapp|notion|youtube|linkedin|instagram|chrome|firefox|edge|browser|slack|discord|spotify|facebook|twitter|mail|email)\b/i;

const FOLDER_ALIASES: Record<string, WellKnownFolder> = {
  download: "downloads",
  downloads: "downloads",
  document: "documents",
  documents: "documents",
  desktop: "desktop",
};

function normalizeFolderKey(raw: string): WellKnownFolder | null {
  const key = raw.trim().toLowerCase().replace(/['"]/g, "");
  return FOLDER_ALIASES[key] ?? null;
}

/**
 * Parse desktop-only voice commands:
 * - "Open Downloads" / "Open my Documents"
 * - "Open Resume.pdf" / "Open file Report.docx"
 */
export function parseDesktopCommand(command?: string | null): DesktopOpenIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd || WEB_OR_APP_OPEN.test(cmd)) return null;

  const folderOnly = cmd.match(
    /^\s*open\s+(?:my\s+)?(downloads?|documents?|desktop)\s*\.?\s*$/i,
  );
  if (folderOnly?.[1]) {
    const folder = normalizeFolderKey(folderOnly[1]);
    if (folder) return { kind: "folder", folder };
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

  return null;
}

export function isDesktopOpenCommand(command?: string | null): boolean {
  return parseDesktopCommand(command) !== null;
}
