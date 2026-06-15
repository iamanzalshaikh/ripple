import { homedir } from "node:os";
import { join } from "node:path";

const WELL_KNOWN_FOLDERS: Record<string, string> = {
  download: "Downloads",
  downloads: "Downloads",
  document: "Documents",
  documents: "Documents",
  desktop: "Desktop",
};

function wellKnownFolderPath(spoken: string): string | null {
  const key = spoken.trim().toLowerCase().replace(/['"]/g, "");
  const folder = WELL_KNOWN_FOLDERS[key];
  return folder ? join(homedir(), folder) : null;
}

/**
 * Turn spoken paths into real Windows paths.
 * Handles: in Downloads/foo, C Users ANZAL Downloads, D Projects/foo, see users...
 */
export function normalizeSpokenPath(raw: string): string {
  let p = raw.trim().replace(/\//g, "\\");
  // Whisper inserts commas: "in download, test 1" -> "in download test 1"
  p = p.replace(/,\s*/g, " ");

  if (p.startsWith("~")) {
    return join(homedir(), p.slice(1).replace(/^\\/, ""));
  }

  // "in Downloads" / "in Downloads test folder"
  const inFolder = p.match(
    /^\s*in\s+(downloads?|documents?|desktop)(?:\s+(.+))?\s*$/i,
  );
  if (inFolder) {
    const base = wellKnownFolderPath(inFolder[1]);
    if (base) {
      const sub = inFolder[2]?.trim();
      return sub ? join(base, sub.replace(/\\/g, " ")) : base;
    }
  }

  // Whisper often hears "C" as "see"
  const seeUsers = p.match(/^\s*see\s+users\s+(.+)$/i);
  if (seeUsers?.[1]) {
    const rest = seeUsers[1].trim().replace(/\s+/g, "\\");
    return join("C:\\Users", rest);
  }

  if (/^[A-Za-z]:\\/.test(p)) {
    return p;
  }

  // "C Users ANZAL Downloads foo" — only when second word is a real path root (not "in")
  const driveRoot = p.match(
    /^\s*([A-Za-z])\s+(users|projects|work|windows)(?:\s+(.+))?\s*$/i,
  );
  if (driveRoot) {
    const letter = driveRoot[1].toUpperCase();
    const root = driveRoot[2].toLowerCase();
    const tail = driveRoot[3]?.trim().replace(/\s+/g, "\\") ?? "";
    if (root === "users") {
      return tail ? join(`${letter}:\\Users`, tail) : `${letter}:\\Users`;
    }
    return tail
      ? join(`${letter}:\\${driveRoot[2]}`, tail)
      : `${letter}:\\${driveRoot[2]}`;
  }

  // "D Projects Portfolio" (single-letter drive + generic folder name)
  const driveGeneric = p.match(/^\s*([A-Za-z])\s+([A-Za-z].+)$/);
  if (driveGeneric && !/^(in|on|at|my|the)\s/i.test(p)) {
    const letter = driveGeneric[1].toUpperCase();
    const rest = driveGeneric[2].trim().replace(/\s+/g, "\\");
    return `${letter}:\\${rest}`;
  }

  // Bare well-known folder name
  const known = wellKnownFolderPath(p);
  if (known) return known;

  return p;
}
