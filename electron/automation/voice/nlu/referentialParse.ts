import { normalizeTranscript } from "../normalizeTranscript.js";
import { isTemporalFileOpenQuery } from "../../retriever/timeRange.js";
import type { SessionMemoryIntent } from "../../desktop/parseSessionMemoryCommand.js";
import type { RecallTarget } from "../../desktop/parseSessionMemoryCommand.js";

/**
 * Phase 4.6 — "it", "that", "same thing", "go back" without exact grammar.
 */
export function parseReferentialRecall(
  command?: string | null,
): SessionMemoryIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  const lower = cmd.toLowerCase();

  if (/^\s*same\s+file\s+again\s*$/i.test(lower)) {
    return recall("file");
  }

  if (/^\s*(?:open\s+)?same\s+file\s+again\s*$/i.test(lower)) {
    return recall("file");
  }

  if (
    /^\s*(?:open\s+)?same\s+folder\s+again\s*$/i.test(lower) ||
    /^\s*same\s+folder\s+again\s*$/i.test(lower)
  ) {
    return recall("folder");
  }

  if (
    /^\s*(?:save,?\s*)+(?:same\s+)?folder\s+again\s*$/i.test(lower) ||
    /^\s*save\s+folder\s+again\s*$/i.test(lower)
  ) {
    return recall("folder");
  }

  if (
    /^\s*(?:yeah|ok|okay|please)?\s*(?:open\s+)?(?:it|that)\s+again\s*$/i.test(
      lower,
    ) ||
    /^\s*(?:open\s+)?(?:it|that)\s+back\s*$/i.test(lower) ||
    /^\s*same\s+(?:thing|one)\s+again\s*$/i.test(lower) ||
    /^\s*bring\s+(?:it|that)\s+back\s*$/i.test(lower) ||
    /^\s*reopen\s+(?:what\s+I\s+had\s+open|that)\s*$/i.test(lower) ||
    /^\s*open\s+what\s+I\s+(?:just\s+)?had\s+open\s*$/i.test(lower)
  ) {
    return recall("auto");
  }

  if (
    /\b(?:go\s+back\s+to|back\s+to)\s+(?:that|the)\s+folder\b/i.test(lower) ||
    /^\s*(?:that|the)\s+folder\s+again\s*$/i.test(lower) ||
    /^\s*same\s+folder\s+again\s*$/i.test(lower)
  ) {
    return recall("folder");
  }

  if (
    /\b(?:go\s+back\s+to|back\s+to)\s+(?:that|the)\s+file\b/i.test(lower) ||
    /^\s*(?:that|the)\s+file\s+again\s*$/i.test(lower) ||
    /^\s*open\s+the\s+same\s+file\s*$/i.test(lower)
  ) {
    return recall("file");
  }

  if (
    !isTemporalFileOpenQuery(cmd) &&
    (/^\s*open\s+(?:the\s+)?last\s*pdf(?![.\w])\b/i.test(lower) ||
      /^\s*open\s+(?:the\s+)?pdf\s+I\s+(?:had\s+)?open(?:ed)?\s*\.?\s*$/i.test(
        lower,
      ))
  ) {
    return recall("pdf");
  }

  if (
    /\b(?:go\s+back\s+to|switch\s+back\s+to)\s+(?:that|the)\s+(?:app|window)\b/i.test(
      lower,
    ) ||
    /^\s*same\s+app\s+again\s*$/i.test(lower)
  ) {
    return recall("app");
  }

  if (
    /\b(?:go\s+back\s+to|open)\s+(?:that|the)\s+workspace\b/i.test(lower) ||
    /^\s*same\s+workspace\s+again\s*$/i.test(lower)
  ) {
    return recall("workspace");
  }

  if (
    /^\s*open\s+(?:that|the)\s+project\s*$/i.test(lower) ||
    /^\s*(?:that|the)\s+project\s+again\s*$/i.test(lower) ||
    /^\s*open\s+(?:that|the)\s+project\s+again\s*$/i.test(lower) ||
    /\bopen\s+(?:woh|that)\s+[\w\s]*project\b/i.test(lower) ||
    /^\s*(?:woh|that)\s+project\s+(?:open|kholo)/i.test(lower)
  ) {
    return recall("folder");
  }

  if (/^\s*go\s+back\s*$/i.test(lower) || /^\s*take\s+me\s+back\s*$/i.test(lower)) {
    return recall("parent");
  }

  return null;
}

function recall(target: RecallTarget): SessionMemoryIntent {
  return { kind: "recall_memory", target };
}
