import { normalizeTranscript } from "../voice/normalizeTranscript.js";

export type UndoIntent = { kind: "undo_last" };

/** P4.7 — voice undo for last mutating desktop action. */
export function parseUndoCommand(command?: string | null): UndoIntent | null {
  const cmd = normalizeTranscript(command ?? "").toLowerCase();
  if (!cmd) return null;

  if (
    /^\s*(?:undo\s+last\s+action|undo\s+last|undo\s+that|undo)\s*$/i.test(cmd) ||
    /^\s*wapas\s+karo\s*$/i.test(cmd) ||
    /^\s*wapas\s+kar\s*do\s*$/i.test(cmd) ||
    /^\s*undo\s+kar\s*do\s*$/i.test(cmd) ||
    /^\s*revert\s+last\s+action\s*$/i.test(cmd)
  ) {
    return { kind: "undo_last" };
  }

  return null;
}
