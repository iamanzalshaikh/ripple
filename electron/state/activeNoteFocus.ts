/**
 * P10.1 — tracks which note (if any) currently has its body textarea
 * focused in the Notes UI. Renderer-reported via IPC on focus/blur.
 * Used by focusedFieldDictation.ts to allow dictation into Ripple's own
 * Notes window, which is excluded by default for every other Ripple surface.
 */
let activeNoteId: string | null = null;

export function setActiveNoteId(id: string | null): void {
  activeNoteId = id;
}

export function getActiveNoteId(): string | null {
  return activeNoteId;
}
