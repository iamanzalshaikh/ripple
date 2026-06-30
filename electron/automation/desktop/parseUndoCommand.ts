import { normalizeTranscript } from "../voice/normalizeTranscript.js";

export type UndoIntent = { kind: "undo_last" };
export type UndoCommandIntent = UndoIntent;

const UNDO_PATTERNS = [
  /^\s*(?:undo\s+last\s+action|undo\s+last|undo\s+that|undo)\s*$/i,
  /^\s*revert\s+last\s+action\s*$/i,
  /^\s*revert\s+that\s*$/i,
  /^\s*revert\s*$/i,
  /^\s*wapas\s+karo\s*$/i,
  /^\s*wapas\s+kar\s*do\s*$/i,
  /^\s*undo\s+kar\s*do\s*$/i,
  /^\s*last\s+action\s+wapas\s*$/i,
  /^\s*pichla\s+action\s+wapas\s*$/i,
  /^\s*pichla\s+undo\s*$/i,
  /^\s*ulta\s+karo\s*$/i,
];

/** P4.7 — voice undo for last mutating desktop action. */
export function parseUndoCommand(command?: string | null): UndoIntent | null {
  const cmd = normalizeTranscript(command ?? "").toLowerCase();
  if (!cmd) return null;

  if (UNDO_PATTERNS.some((re) => re.test(cmd))) {
    return { kind: "undo_last" };
  }

  return null;
}
