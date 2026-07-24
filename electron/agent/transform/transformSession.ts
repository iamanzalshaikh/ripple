/**
 * P8 — Transforms pending-selection state.
 * Deliberately separate from dictationSession.ts: a Transform utterance is
 * a rewrite instruction, not dictated content, and must never enter the
 * P7 revision buffer, the P7.5 session window, or the planner.
 */

// Stale-selection backstop: if a recording is cancelled, times out, or STT
// comes back empty, no call site is guaranteed to clear the stash directly.
// A TTL means a leaked selection can never bleed into a later, unrelated
// dictation no matter which path dropped the ball.
const PENDING_TTL_MS = 90_000;

let pendingSelection: string | null = null;
let pendingSetAt = 0;

export function setPendingSelection(text: string | null): void {
  // Keep exact selection (incl. inner spaces) so partial replace can match the field.
  const cleaned = text && text.replace(/\r\n/g, "\n");
  const trimmed = cleaned && cleaned.trim() ? cleaned : null;
  pendingSelection = trimmed;
  pendingSetAt = trimmed ? Date.now() : 0;
}

export function hasPendingSelection(): boolean {
  return pendingSelection !== null && Date.now() - pendingSetAt <= PENDING_TTL_MS;
}

/** Read and clear in one step so a selection is only ever consumed once. */
export function takePendingSelection(): string | null {
  const text = pendingSelection;
  const setAt = pendingSetAt;
  pendingSelection = null;
  pendingSetAt = 0;
  if (!text) return null;
  return Date.now() - setAt <= PENDING_TTL_MS ? text : null;
}

export function resetTransformSessionForTests(): void {
  pendingSelection = null;
  pendingSetAt = 0;
}
