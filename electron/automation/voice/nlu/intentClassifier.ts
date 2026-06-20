import { parseFileOperationCommand } from "../../desktop/parseFileOperationCommand.js";
import type { NativeCommandIntent } from "../../desktop/parseNativeCommand.js";
import { parseNativeCommandStrict } from "../../desktop/parseNativeCommand.js";
import { parseNativeAppCommand } from "../../desktop/parseNativeAppCommand.js";
import { parseSmartSearchCommand } from "../../desktop/parseSmartSearchCommand.js";
import { parseWellKnownFolderOpen } from "../../desktop/folderIntent.js";
import { parseSessionMemoryCommand } from "../../desktop/parseSessionMemoryCommand.js";
import { parseReferentialRecall } from "./referentialParse.js";

export type IntentFamily =
  | "recall"
  | "open_folder"
  | "open_file"
  | "file_op"
  | "app"
  | "search"
  | "unknown";

/** Lightweight local classifier — routes to the right parser family. */
export function classifyIntentFamily(cmd: string): IntentFamily {
  const lower = cmd.toLowerCase();

  if (
    /\b(?:again|go\s+back|same\s+(?:file|folder|thing)|reopen|bring\s+back|dubara|phir\s+se)\b/i.test(
      lower,
    ) ||
    /\bopen\s+(?:the\s+)?last\s+(?:pdf|file|folder)\b/i.test(lower) ||
    /\bopen\s+(?:the\s+)?pdf\s+I\s+(?:had\s+)?open/i.test(lower)
  ) {
    return "recall";
  }

  if (/\b(?:delete|remove|rename|move|create)\b/i.test(lower)) {
    return "file_op";
  }

  if (/\bsearch\b/i.test(lower)) {
    return "search";
  }

  if (
    /\b(?:launch|open|switch|close|start)\s+(?:the\s+)?(?:app\s+)?(?:vs\s*code|cursor|chrome|spotify|discord|calculator|notepad)\b/i.test(
      lower,
    ) ||
    /\b(?:launch|switch\s+to|close)\s+\w+/i.test(lower)
  ) {
    return "app";
  }

  if (
    /\b(?:resume|invoice|download|yesterday|latest|last\s+downloaded|pdf)\b/i.test(
      lower,
    )
  ) {
    return "search";
  }

  if (
    /\b(?:downloads?|documents?|desktop)\b/i.test(lower) &&
    /\b(?:open|show|folder)\b/i.test(lower)
  ) {
    return "open_folder";
  }

  if (/\b(?:open|show|find|get)\s+(?:my\s+)?[\w]/i.test(lower)) {
    return "open_file";
  }

  return "unknown";
}

/**
 * Phase 4.6 Layer 2 — retry parsers guided by intent family when strict regex missed.
 */
export function parseByIntentClassifier(cmd: string): NativeCommandIntent | null {
  const family = classifyIntentFamily(cmd);
  if (family === "unknown") return null;

  switch (family) {
    case "recall":
      return (
        parseReferentialRecall(cmd) ??
        parseSessionMemoryCommand(cmd)
      );

    case "open_folder": {
      const folder = parseWellKnownFolderOpen(cmd);
      if (folder) return folder;
      return parseNativeCommandStrict(cmd);
    }

    case "file_op":
      return parseFileOperationCommand(cmd);

    case "app":
      return parseNativeAppCommand(cmd);

    case "search":
      return parseSmartSearchCommand(cmd);

    case "open_file":
      return (
        parseSmartSearchCommand(cmd) ?? parseNativeCommandStrict(cmd)
      );

    default:
      return null;
  }
}
