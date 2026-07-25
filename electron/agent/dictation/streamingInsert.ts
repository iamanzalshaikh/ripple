/**
 * Phase 7.8 — Streaming / live type-as-you-speak.
 *
 * PAUSED (2026-07-25): default OFF. Mid-stream typing was thrashing focused
 * apps (Cursor / ChatGPT / Claude) and damaging open documents. Batch insert
 * on hotkey-release is the stable path again (pre-7.8).
 *
 * Re-enable later only with real streaming STT:
 *   RIPPLE_P85_STREAMING_INSERT=1
 *
 * Skips progressive insert for: transforms, WhatsApp, Gmail, Instagram, etc.
 */

import { delay } from "../../automation/delay.js";
import { sendKeyChord } from "../../automation/keyboard.js";
import { runInsertWithFallback } from "../../automation/input/inputStrategy.js";
import {
  restoreFocusContext,
  resolveTypingFocusTarget,
  isWhatsAppTabActive,
  isGmailComposeFocused,
  isInstagramTabActive,
} from "../../focus/focusContext.js";
import { hasPendingSelection } from "../transform/transformSession.js";

/** P7.8 paused — opt-in only. */
export function isStreamingInsertEnabled(): boolean {
  return process.env.RIPPLE_P85_STREAMING_INSERT === "1";
}

export type StreamingSurface = "os" | "note" | "skip";

type StreamingState = {
  streamId: string;
  /** Text actually typed into the field (append-only during partials). */
  provisional: string;
  /** Latest Whisper hypothesis (may diverge; used only for logging). */
  latestHypothesis: string;
  surface: StreamingSurface;
  noteId: string | null;
  noteBaseBody: string;
  busy: boolean;
  lastPartialAt: number;
};

let state: StreamingState | null = null;

/** Pure helper — how to go from previous provisional → next hypothesis. */
export function computeProvisionalEdit(
  previous: string,
  next: string,
): { backspace: number; type: string } {
  if (next === previous) return { backspace: 0, type: "" };
  if (next.startsWith(previous)) {
    return { backspace: 0, type: next.slice(previous.length) };
  }
  if (previous.startsWith(next)) {
    return { backspace: previous.length - next.length, type: "" };
  }
  // Find common prefix length to minimize churn when Whisper rewrites mid-string.
  let i = 0;
  const lim = Math.min(previous.length, next.length);
  while (i < lim && previous[i] === next[i]) i += 1;
  return {
    backspace: previous.length - i,
    type: next.slice(i),
  };
}

/**
 * Mid-stream policy: only grow the typed span.
 * Whisper re-transcribes the whole buffer each flush and often rewrites earlier
 * words — applying those as backspaces causes the cut/rewrite loop the user hit.
 * Divergent hypotheses are ignored until final reconcile.
 */
export function shouldApplyPartialLive(
  typedProvisional: string,
  hypothesis: string,
): boolean {
  if (!hypothesis) return false;
  if (!typedProvisional) return true;
  return hypothesis.startsWith(typedProvisional);
}

export function beginStreamingInsert(args: {
  streamId: string;
  noteId?: string | null;
  noteBaseBody?: string;
}): void {
  if (!isStreamingInsertEnabled()) return;
  state = {
    streamId: args.streamId,
    provisional: "",
    latestHypothesis: "",
    surface: "os",
    noteId: args.noteId ?? null,
    noteBaseBody: args.noteBaseBody ?? "",
    busy: false,
    lastPartialAt: 0,
  };
  if (args.noteId) {
    state.surface = "note";
  }
  console.info(
    `[ripple-stream] begin stream=${args.streamId.slice(0, 8)} surface=${state.surface}`,
  );
}

export function getStreamingProvisional(): string {
  return state?.provisional ?? "";
}

export function hasStreamingProvisional(): boolean {
  return Boolean(state && state.provisional.length > 0);
}

/** Snapshot + clear for final reconcile. */
export function takeStreamingProvisional(): {
  provisional: string;
  surface: StreamingSurface;
  noteId: string | null;
  noteBaseBody: string;
} | null {
  if (!state) return null;
  const snap = {
    provisional: state.provisional,
    surface: state.surface,
    noteId: state.noteId,
    noteBaseBody: state.noteBaseBody,
  };
  state = null;
  return snap;
}

export function clearStreamingInsert(): void {
  state = null;
}

async function backspaceChars(count: number): Promise<void> {
  let left = count;
  while (left > 0) {
    const batch = Math.min(left, 40);
    await sendKeyChord(`{BACKSPACE ${batch}}`);
    left -= batch;
    await delay(20);
  }
}

/**
 * Bug fix (7.8 finalization) — this previously only excluded WhatsApp, but
 * the exact same failure mode (native keystroke injection doesn't reliably
 * reach a browser contenteditable box) is already proven for Gmail and
 * Instagram too — Instagram specifically was found and fixed as a real bug
 * earlier in this project. Progressive live-typing must skip all three and
 * defer to their dedicated compose-insert handlers via the final reconcile's
 * "skip" surface, exactly like WhatsApp already does.
 */
function shouldSkipOsProgressive(): boolean {
  if (hasPendingSelection()) return true;
  try {
    if (isWhatsAppTabActive()) return true;
    if (isGmailComposeFocused()) return true;
    if (isInstagramTabActive()) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Apply a partial transcript hypothesis into the field / note.
 * Fail-open: errors leave prior provisional as-is.
 */
export async function applyStreamingPartial(args: {
  streamId: string;
  text: string;
}): Promise<void> {
  if (!isStreamingInsertEnabled()) return;
  if (!state || state.streamId !== args.streamId) return;
  if (state.busy) return;

  const next = args.text.replace(/\s+/g, " ").trim();
  if (!next) return;
  if (next === state.provisional) return;

  state.latestHypothesis = next;

  // Transforms / WhatsApp — keep listening UI but don't type mid-utterance.
  if (state.surface !== "note" && shouldSkipOsProgressive()) {
    if (state.surface !== "skip") {
      state.surface = "skip";
      console.info("[ripple-stream] progressive skipped (transform/whatsapp)");
    }
    state.provisional = next; // track for awareness only
    return;
  }

  // Append-only: never backspace mid-stream when Whisper rewrites earlier words.
  if (!shouldApplyPartialLive(state.provisional, next)) {
    console.info(
      `[ripple-stream] skip rewrite (append-only) typed=${state.provisional.length} hyp=${next.length}`,
    );
    return;
  }

  state.busy = true;
  try {
    if (state.surface === "note" && state.noteId) {
      const { updateNote, getNote } = await import("../../storage/notes.js");
      const existing = getNote(state.noteId);
      if (!existing) return;
      const sep =
        state.noteBaseBody && !/\s$/.test(state.noteBaseBody) && next
          ? " "
          : "";
      const body = `${state.noteBaseBody}${sep}${next}`;
      const updated = updateNote(state.noteId, { body });
      if (updated) {
        try {
          const { getMainWindow } = await import("../../windows/mainWindow.js");
          getMainWindow()?.webContents.send("notes:bodyAppended", {
            noteId: updated.id,
            body: updated.body,
          });
        } catch {
          /* UI refresh best-effort */
        }
      }
      state.provisional = next;
      state.lastPartialAt = Date.now();
      console.info(
        `[ripple-stream] note partial len=${next.length} stream=${args.streamId.slice(0, 8)}`,
      );
      return;
    }

    // OS field — append delta only (no mid-stream backspace).
    const edit = computeProvisionalEdit(state.provisional, next);
    if (edit.backspace > 0) {
      // Should be unreachable under append-only; refuse to protect prior text.
      console.warn(
        `[ripple-stream] refused mid-stream backspace=${edit.backspace}`,
      );
      return;
    }
    if (!edit.type) return;

    await restoreFocusContext();
    await delay(50);
    await runInsertWithFallback(edit.type, {
      verify: false,
      includeVision: false,
      preferFirst: edit.type.length > 80 ? "clipboard_paste" : "native_text",
      abortLadderOnPartialNativeFail: true,
    });
    state.provisional = next;
    state.lastPartialAt = Date.now();
    console.info(
      `[ripple-stream] os partial len=${next.length} append=${edit.type.length} ` +
        `target=${resolveTypingFocusTarget()?.processName ?? "?"}`,
    );
  } catch (e: unknown) {
    console.warn(
      "[ripple-stream] partial apply failed open:",
      e instanceof Error ? e.message : e,
    );
  } finally {
    if (state) state.busy = false;
  }
}

/**
 * After final prepare: replace provisional with cleaned text (or no-op).
 * Caller must NOT have already inserted finalText.
 */
export async function reconcileStreamingFinal(args: {
  finalText: string;
  snap: {
    provisional: string;
    surface: StreamingSurface;
    noteId: string | null;
    noteBaseBody: string;
  };
}): Promise<"replaced" | "noop" | "inserted"> {
  const { finalText, snap } = args;
  const final = finalText.trim();
  const prev = snap.provisional.trim();

  if (snap.surface === "note" && snap.noteId) {
    const { updateNote } = await import("../../storage/notes.js");
    const sep =
      snap.noteBaseBody && !/\s$/.test(snap.noteBaseBody) && final ? " " : "";
    const body = `${snap.noteBaseBody}${sep}${final}`;
    updateNote(snap.noteId, { body });
    try {
      const { getMainWindow } = await import("../../windows/mainWindow.js");
      getMainWindow()?.webContents.send("notes:bodyAppended", {
        noteId: snap.noteId,
        body,
      });
    } catch {
      /* ignore */
    }
    return prev === final ? "noop" : "replaced";
  }

  if (snap.surface === "skip" || !prev) {
    return "inserted"; // caller should run normal insert
  }

  if (prev === final) {
    console.info("[ripple-stream] reconcile noop — provisional matched final");
    return "noop";
  }

  try {
    await restoreFocusContext();
    await delay(80);
    const edit = computeProvisionalEdit(prev, final);
    if (edit.backspace > 0) await backspaceChars(edit.backspace);
    if (edit.type) {
      await runInsertWithFallback(edit.type, {
        verify: false,
        includeVision: false,
        preferFirst: edit.type.length > 80 ? "clipboard_paste" : "native_text",
        abortLadderOnPartialNativeFail: true,
      });
    }
    console.info(
      `[ripple-stream] reconcile replaced provisional=${prev.length} final=${final.length}`,
    );
    return "replaced";
  } catch (e: unknown) {
    console.warn(
      "[ripple-stream] reconcile failed — caller should fall back to full insert:",
      e instanceof Error ? e.message : e,
    );
    return "inserted";
  }
}
