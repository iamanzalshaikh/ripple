import { slotNormalize } from "../voice/nlu/slotNormalize.js";
import { isEditorClearTextPhrase } from "../../agent/parseDesktopInput.js";
import {
  parseParentKey,
  parseLocationSuffix,
  splitItemAndLocation,
  stripItemFiller,
  takePrimaryFileOpCommand,
} from "./fileOpParse.js";

/** Absolute Windows path (spaces allowed). Keep in sync with fileOpParse.ts. */
const ABS_PATH_LOCATION =
  "[a-zA-Z]:\\\\(?:[^\\\\/:*?\"<>|\\r\\n]+\\\\)*[^\\\\/:*?\"<>|\\r\\n]*";
const LOC_WORD = `downloads?|documents?|desktop|${ABS_PATH_LOCATION}`;

const LOC_IN = new RegExp(
  `^(.+?)\\s+(?:in|inside)\\s+(?:my\\s+|the\\s+)?(${LOC_WORD})\\s*$`,
  "i",
);

/** Shared absolute-path fragment for named-first create patterns. */
const LOC_CAPTURE = `(?:my\\s+|the\\s+)?(${LOC_WORD})`;

export type FileOpIntent =
  | { kind: "create_folder"; name: string; parent?: string }
  | { kind: "create_file"; name: string; parent?: string }
  | { kind: "rename_file"; sourceName: string; newName: string; parent?: string }
  | { kind: "move_file"; sourceName: string; destination: string; parent?: string }
  | { kind: "delete_file"; sourceName: string; parent?: string };

/** "on (the) C drive" / "on drive C" → "in C:\" so the existing in/inside
 * location handling picks it up as a real path instead of the phrase
 * silently becoming part of the item's name (wave0 TEST 1). */
function normalizeDriveLetterPhrase(cmd: string): string {
  return cmd
    .replace(/\bon\s+(?:the\s+)?([a-zA-Z])\s*drive\b/i, "in $1:\\")
    .replace(/\bon\s+drive\s+([a-zA-Z])\b/i, "in $1:\\");
}

export function parseFileOperationCommand(
  command?: string | null,
): FileOpIntent | null {
  const raw = slotNormalize(command ?? "");
  if (!raw) return null;
  if (isEditorClearTextPhrase(raw)) return null;

  const cmd = normalizeDriveLetterPhrase(takePrimaryFileOpCommand(raw));
  const { body, parent: suffixParent } = parseLocationSuffix(cmd);

  // "Rename Anzal from Downloads to User"
  const renameFromTo = body.match(
    /^\s*rename\s+(?:the\s+)?(?:file\s+|folder\s+)?(?:named\s+|called\s+)?(.+?)\s+from\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop|[a-zA-Z]:\\\S*)\s+to\s+(.+?)\s*$/i,
  );
  if (renameFromTo?.[1] && renameFromTo[2] && renameFromTo[3]) {
    return {
      kind: "rename_file",
      sourceName: stripItemFiller(renameFromTo[1]),
      newName: stripItemFiller(renameFromTo[3]),
      parent: parseParentKey(renameFromTo[2]),
    };
  }

  // "Rename Flow in Downloads to Heroids"
  const renameInLoc = body.match(
    /^\s*rename\s+(?:the\s+)?(?:file\s+|folder\s+)?(?:named\s+|called\s+)?(.+?)\s+in\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop|[a-zA-Z]:\\\S*)\s+to\s+(.+?)\s*$/i,
  );
  if (renameInLoc?.[1] && renameInLoc[2] && renameInLoc[3]) {
    return {
      kind: "rename_file",
      sourceName: stripItemFiller(renameInLoc[1]),
      newName: stripItemFiller(renameInLoc[3]),
      parent: parseParentKey(renameInLoc[2]),
    };
  }

  const renameMatch = body.match(
    /^\s*rename\s+(?:the\s+)?(?:file\s+|folder\s+)?(?:named\s+|called\s+)?(.+?)\s+to\s+(.+?)\s*$/i,
  );
  if (renameMatch?.[1] && renameMatch[2]) {
    const { item, parent: fromLoc } = splitItemAndLocation(renameMatch[1].trim());
    return {
      kind: "rename_file",
      sourceName: item,
      newName: stripItemFiller(renameMatch[2]),
      parent: fromLoc ?? suffixParent,
    };
  }

  // "Move Anzal from Downloads to Desktop"
  const moveFromTo = body.match(
    /^\s*move\s+(?:the\s+)?(?:file\s+|folder\s+)?(?:named\s+|called\s+)?(.+?)\s+from\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop|[a-zA-Z]:\\\S*)\s+to\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop|[a-zA-Z]:\\\S*)\s*$/i,
  );
  if (moveFromTo?.[1] && moveFromTo[2] && moveFromTo[3]) {
    return {
      kind: "move_file",
      sourceName: stripItemFiller(moveFromTo[1]),
      destination: parseParentKey(moveFromTo[3]),
      parent: parseParentKey(moveFromTo[2]),
    };
  }

  const moveInTo = body.match(
    /^\s*move\s+(?:the\s+)?(?:file\s+|folder\s+)?(?:named\s+|called\s+)?(.+?)\s+in\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop|[a-zA-Z]:\\\S*)\s+to\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop|[a-zA-Z]:\\\S*)\s*$/i,
  );
  if (moveInTo?.[1] && moveInTo[2] && moveInTo[3]) {
    return {
      kind: "move_file",
      sourceName: stripItemFiller(moveInTo[1]),
      destination: parseParentKey(moveInTo[3]),
      parent: parseParentKey(moveInTo[2]),
    };
  }

  const moveMatch = body.match(
    /^\s*move\s+(?:the\s+)?(?:file\s+|folder\s+)?(?:named\s+|called\s+)?(.+?)\s+to\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop|[a-zA-Z]:\\\S*)\s*$/i,
  );
  if (moveMatch?.[1] && moveMatch[2]) {
    const { item, parent: fromLoc } = splitItemAndLocation(moveMatch[1].trim());
    return {
      kind: "move_file",
      sourceName: item,
      destination: parseParentKey(moveMatch[2]),
      parent: fromLoc ?? suffixParent,
    };
  }

  const deleteMatch = body.match(
    /^\s*delete\s+(?:the\s+)?(?:file\s+|folder\s+)?(.+?)\s*$/i,
  );
  if (deleteMatch?.[1]) {
    const { item, parent: fromLoc } = splitItemAndLocation(deleteMatch[1].trim());
    return {
      kind: "delete_file",
      sourceName: item,
      parent: fromLoc ?? suffixParent,
    };
  }

  const folderInLocFirst = body.match(
    new RegExp(
      `^\\s*in\\s+${LOC_CAPTURE}\\s*,?\\s*create\\s+(?:a\\s+)?(?:new\\s+)?folder\\s+(?:name|named|called)\\s+(.+?)\\s*$`,
      "i",
    ),
  );
  if (folderInLocFirst?.[1] && folderInLocFirst[2]) {
    return {
      kind: "create_folder",
      name: stripItemFiller(folderInLocFirst[2]),
      parent: parseParentKey(folderInLocFirst[1]),
    };
  }

  const folderLocFirst = body.match(
    new RegExp(
      `^\\s*create\\s+(?:a\\s+)?(?:new\\s+)?folder\\s+(?:in|inside)\\s+${LOC_CAPTURE}\\s*,?\\s*(?:name|named|called)\\s+(.+?)\\s*$`,
      "i",
    ),
  );
  if (folderLocFirst?.[1] && folderLocFirst[2]) {
    return {
      kind: "create_folder",
      name: stripItemFiller(folderLocFirst[2]),
      parent: parseParentKey(folderLocFirst[1]),
    };
  }

  // Named-first with in/inside — must beat the catch-all folderMatch below.
  const folderNamedFirst = body.match(
    new RegExp(
      `^\\s*create\\s+(?:a\\s+)?(?:new\\s+)?folder\\s+(?:name|named|called)\\s+(.+?)\\s+(?:in|inside)\\s+${LOC_CAPTURE}\\s*$`,
      "i",
    ),
  );
  if (folderNamedFirst?.[1] && folderNamedFirst[2]) {
    return {
      kind: "create_folder",
      name: stripItemFiller(folderNamedFirst[1]),
      parent: parseParentKey(folderNamedFirst[2]),
    };
  }

  const folderMatch = body.match(
    /^\s*create\s+(?:a\s+)?(?:new\s+)?folder\s+(?:called\s+|named\s+)?(.+?)\s*$/i,
  );
  if (folderMatch?.[1]) {
    const nameRaw = folderMatch[1].trim();
    const inMid = nameRaw.match(LOC_IN);
    if (inMid?.[1] && inMid[2]) {
      return {
        kind: "create_folder",
        name: stripItemFiller(inMid[1]),
        parent: parseParentKey(inMid[2]),
      };
    }
    return {
      kind: "create_folder",
      name: stripItemFiller(nameRaw),
      parent: suffixParent,
    };
  }

  const fileLocFirst = body.match(
    new RegExp(
      `^\\s*create\\s+(?:a\\s+)?(?:new\\s+)?(?:file|document)\\s+(?:in|inside)\\s+${LOC_CAPTURE}\\s*,?\\s*(?:name|named|called)\\s+(.+?)\\s*$`,
      "i",
    ),
  );
  if (fileLocFirst?.[1] && fileLocFirst[2]) {
    return {
      kind: "create_file",
      name: stripItemFiller(fileLocFirst[2]),
      parent: parseParentKey(fileLocFirst[1]),
    };
  }

  // Explicit named-first create-file (Wave 0 T6) — beat catch-all fileMatch.
  const fileNamedFirst = body.match(
    new RegExp(
      `^\\s*create\\s+(?:a\\s+)?(?:new\\s+)?(?:file|document)\\s+(?:name|named|called)\\s+(.+?)\\s+(?:in|inside)\\s+${LOC_CAPTURE}\\s*$`,
      "i",
    ),
  );
  if (fileNamedFirst?.[1] && fileNamedFirst[2]) {
    return {
      kind: "create_file",
      name: stripItemFiller(fileNamedFirst[1]),
      parent: parseParentKey(fileNamedFirst[2]),
    };
  }

  const fileMatch = body.match(
    /^\s*create\s+(?:a\s+)?(?:new\s+)?(?:file|document)\s+(?:called\s+|named\s+)?(.+?)\s*$/i,
  );
  if (fileMatch?.[1]) {
    const nameRaw = fileMatch[1].trim();
    const inMid = nameRaw.match(LOC_IN);
    if (inMid?.[1] && inMid[2]) {
      return {
        kind: "create_file",
        name: stripItemFiller(inMid[1]),
        parent: parseParentKey(inMid[2]),
      };
    }
    return {
      kind: "create_file",
      name: stripItemFiller(nameRaw),
      parent: suffixParent,
    };
  }

  return null;
}
