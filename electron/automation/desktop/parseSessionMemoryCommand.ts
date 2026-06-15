import { normalizeTranscript } from "../voice/normalizeTranscript.js";

export type RecallTarget = "auto" | "file" | "folder" | "workspace" | "app";

export type SessionMemoryIntent = {
  kind: "recall_memory";
  target: RecallTarget;
};

/**
 * Phase 4.6 — reopen last file/folder/workspace from local memory.
 */
export function parseSessionMemoryCommand(
  command?: string | null,
): SessionMemoryIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  if (
    /^\s*(?:open\s+)?(?:it|that)\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*reopen\s+(?:it|that)\s*\.?\s*$/i.test(cmd) ||
    /^\s*open\s+(?:the\s+)?last\s+(?:thing|item)\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "recall_memory", target: "auto" };
  }

  if (
    /^\s*(?:open\s+)?(?:the\s+)?last\s+file\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*open\s+a\s+last\s+file\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*open\s+(?:that|the)\s+file\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*reopen\s+(?:the\s+)?last\s+file\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "recall_memory", target: "file" };
  }

  if (
    /^\s*(?:open\s+)?(?:the\s+)?last\s+folder\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*open\s+(?:that|the)\s+folder\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*reopen\s+(?:the\s+)?last\s+folder\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "recall_memory", target: "folder" };
  }

  if (
    /^\s*(?:open\s+)?(?:the\s+)?last\s+project\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*open\s+(?:my\s+)?last\s+project\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "recall_memory", target: "folder" };
  }

  if (
    /^\s*(?:open\s+)?(?:the\s+)?last\s+workspace\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*open\s+(?:that|the)\s+workspace\s+again\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "recall_memory", target: "workspace" };
  }

  if (
    /^\s*(?:open\s+)?(?:the\s+)?last\s+app\s+again\s*\.?\s*$/i.test(cmd) ||
    /^\s*switch\s+to\s+(?:the\s+)?last\s+app\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "recall_memory", target: "app" };
  }

  return null;
}
