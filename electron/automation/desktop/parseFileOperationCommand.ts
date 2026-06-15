import { normalizeTranscript } from "../voice/normalizeTranscript.js";

export type FileOpIntent =
  | { kind: "create_folder"; name: string; parent?: string }
  | { kind: "create_file"; name: string; parent?: string }
  | { kind: "rename_file"; sourceName: string; newName: string; parent?: string }
  | { kind: "move_file"; sourceName: string; destination: string; parent?: string }
  | { kind: "delete_file"; sourceName: string; parent?: string };

const PARENT_SUFFIX =
  /\s+in\s+(?:my\s+)?(downloads?|documents?|desktop)\s*\.?\s*$/i;

function parseParentKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key.startsWith("download")) return "downloads";
  if (key.startsWith("document")) return "documents";
  return "desktop";
}

function parseParentSuffix(cmd: string): { body: string; parent?: string } {
  const match = cmd.match(PARENT_SUFFIX);
  if (!match?.[1]) return { body: cmd };

  return {
    body: cmd.slice(0, match.index).trim(),
    parent: parseParentKey(match[1]),
  };
}

function parseDestinationFolder(raw: string): string {
  return parseParentKey(raw);
}

export function parseFileOperationCommand(
  command?: string | null,
): FileOpIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  const { body, parent: suffixParent } = parseParentSuffix(cmd);

  // "Rename Flow in Downloads to Heroids"
  const renameInLoc = body.match(
    /^\s*rename\s+(?:file\s+|folder\s+)?(.+?)\s+in\s+(?:my\s+)?(downloads?|documents?|desktop)\s+to\s+(.+?)\s*\.?\s*$/i,
  );
  if (renameInLoc?.[1] && renameInLoc[2] && renameInLoc[3]) {
    return {
      kind: "rename_file",
      sourceName: renameInLoc[1].trim(),
      newName: renameInLoc[3].trim(),
      parent: parseParentKey(renameInLoc[2]),
    };
  }

  const renameMatch = body.match(
    /^\s*rename\s+(?:file\s+|folder\s+)?(.+?)\s+to\s+(.+?)\s*\.?\s*$/i,
  );
  if (renameMatch?.[1] && renameMatch[2]) {
    return {
      kind: "rename_file",
      sourceName: renameMatch[1].trim(),
      newName: renameMatch[2].trim(),
      parent: suffixParent,
    };
  }

  // "Move HRMS from Desktop to Downloads" / "Move flow in Desktop to Downloads"
  const moveFromTo = body.match(
    /^\s*move\s+(?:file\s+|folder\s+)?(.+?)\s+(?:from|in)\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop)\s+to\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop)\s*\.?\s*$/i,
  );
  if (moveFromTo?.[1] && moveFromTo[2] && moveFromTo[3]) {
    return {
      kind: "move_file",
      sourceName: moveFromTo[1].trim(),
      destination: parseDestinationFolder(moveFromTo[3]),
      parent: parseParentKey(moveFromTo[2]),
    };
  }

  const moveMatch = body.match(
    /^\s*move\s+(?:file\s+|folder\s+)?(.+?)\s+to\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop)\s*\.?\s*$/i,
  );
  if (moveMatch?.[1] && moveMatch[2]) {
    return {
      kind: "move_file",
      sourceName: moveMatch[1].trim(),
      destination: parseDestinationFolder(moveMatch[2]),
      parent: suffixParent,
    };
  }

  const deleteMatch = body.match(
    /^\s*delete\s+(?:file\s+|folder\s+)?(.+?)\s*\.?\s*$/i,
  );
  if (deleteMatch?.[1]) {
    return {
      kind: "delete_file",
      sourceName: deleteMatch[1].trim(),
      parent: suffixParent,
    };
  }

  const folderMatch = body.match(
    /^\s*create\s+(?:a\s+)?folder\s+(?:called\s+|named\s+)?(.+?)\s*\.?\s*$/i,
  );
  if (folderMatch?.[1]) {
    return {
      kind: "create_folder",
      name: folderMatch[1].trim(),
      parent: suffixParent,
    };
  }

  const fileMatch = body.match(
    /^\s*create\s+(?:a\s+)?file\s+(?:called\s+|named\s+)?(.+?)\s*\.?\s*$/i,
  );
  if (fileMatch?.[1]) {
    return {
      kind: "create_file",
      name: fileMatch[1].trim(),
      parent: suffixParent,
    };
  }

  const docMatch = body.match(
    /^\s*create\s+(?:a\s+)?document\s+(?:called\s+|named\s+)?(.+?)\s*\.?\s*$/i,
  );
  if (docMatch?.[1]) {
    return {
      kind: "create_file",
      name: docMatch[1].trim(),
      parent: suffixParent,
    };
  }

  return null;
}
