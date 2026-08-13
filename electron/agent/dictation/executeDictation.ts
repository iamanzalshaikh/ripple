import { hideOverlay } from "../../windows/overlay.js";
import { runInsertText } from "../../automation/actions/insertText.js";
import { processTranscriptFromStt } from "../../automation/voice/transcriptPipeline.js";
import {
  extendCommandFocusGrace,
  hasDictationInsertTarget,
  prepareDictationInsertFocus,
  recoverDictationFocusTarget,
  resolveTypingFocusTarget,
  restoreFocusContext,
} from "../../focus/focusContext.js";
import {
  appendDictationUtterance,
  confirmDictationBuffer,
  getDictationSession,
  getRevisionBuffer,
  startDictationSession,
} from "./dictationSession.js";
import {
  getSessionStatus,
  recordSessionUtterance,
  type DictationSessionStatus,
} from "./dictationSessionWindow.js";
import { takePendingSelection } from "../transform/transformSession.js";
import { executeTransform } from "../transform/executeTransform.js";
import { recordCommandEvent } from "../../telemetry/commandTelemetry.js";

export type DictationExecuteResult = {
  ok: boolean;
  mode: "dictation";
  finalText?: string;
  inserted?: boolean;
  error?: string;
  correctionKind?: string;
  session?: DictationSessionStatus;
  /** P8 — true when this utterance was a Transforms rewrite instruction, not dictated content. */
  transform?: boolean;
  originalText?: string;
};

/**
 * Language observability — logged immediately after the insert ladder
 * reports its own strategy=... line, so the two are trivially correlatable
 * in the log stream (previously an insert's success was logged with no
 * language tag, and language selection had no telemetry at all — see the
 * P9.5 review). Also persisted to command_telemetry for per-language
 * accuracy queries instead of only living as console output.
 */
function logAndRecordLanguageTelemetry(args: {
  intent: "dictation" | "transform";
  ok: boolean;
  inserted: boolean;
  chars: number;
  requestedLanguage?: string;
  detectedLanguage?: string;
  latencyMs: number;
  /** Q8 — which insert-ladder stage actually delivered the text (from the
   * ladder's own "Typed N characters (strategy)" / "Pasted N characters
   * (strategy)" message), so non-Latin/RTL inserts are traceable to the
   * exact stage instead of only "inserted=true" with no detail. */
  insertDetail?: string;
}): void {
  const strategyMatch = args.insertDetail?.match(/\(([\w_]+)\)\s*$/);
  console.info(
    `[ripple-insert-lang] surface=${args.intent} requested=${args.requestedLanguage ?? "auto"} ` +
      `detected=${args.detectedLanguage ?? "?"} chars=${args.chars} inserted=${args.inserted} ` +
      `strategy=${strategyMatch?.[1] ?? "?"}`,
  );
  recordCommandEvent({
    command: `dictation:${args.intent}`,
    planner_source: "fast",
    outcome: args.ok ? "success" : "error",
    intent: args.intent,
    language: args.requestedLanguage,
    detected_language: args.detectedLanguage,
    latency_ms: args.latencyMs,
  });
}

/** Prefer near-raw STT for correction understanding — avoid NLU command rewrite. */
function dictationUtteranceFromStt(rawTranscript: string): string {
  const snapshot = processTranscriptFromStt(rawTranscript ?? "");
  return (
    snapshot.normalized ||
    snapshot.corrected ||
    snapshot.repaired ||
    snapshot.raw ||
    rawTranscript ||
    ""
  ).trim();
}

/**
 * Full P7 stop path: STT text → revision/corrections → insert ladder.
 * Does **not** call the planner.
 */
export async function executeDictationUtterance(
  rawTranscript: string,
  options?: {
    insert?: boolean;
    /** P9.5 — language picker selection ("auto" or an ISO code) sent for this utterance. */
    requestedLanguage?: string;
    /** P9.5 — language Whisper itself reported detecting for this audio. */
    detectedLanguage?: string;
  },
): Promise<DictationExecuteResult> {
  const startedAt = Date.now();
  const utterance = dictationUtteranceFromStt(rawTranscript);
  if (!utterance) {
    return { ok: false, mode: "dictation", error: "no_speech" };
  }

  // P8 — Transforms (not "Command Mode" — see overlay.ts handleTransformShortcutPress
  // for the naming rationale): a selection captured at hotkey-press time
  // means this utterance is a rewrite instruction, not content to type. Must
  // be checked before anything touches the P7 buffer or the P7.5 session
  // window — a Transform never enters either.
  const pendingSelection = takePendingSelection();
  if (pendingSelection) {
    const result = await executeTransform(pendingSelection, utterance);
    logAndRecordLanguageTelemetry({
      intent: "transform",
      ok: result.ok,
      inserted: result.inserted === true,
      chars: result.finalText?.length ?? 0,
      requestedLanguage: options?.requestedLanguage,
      detectedLanguage: options?.detectedLanguage,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ok: result.ok,
      mode: "dictation",
      finalText: result.finalText,
      originalText: result.originalText,
      inserted: result.inserted,
      error: result.error,
      transform: true,
    };
  }

  // Capture prior buffer BEFORE append — snippet/rewrite must see only this
  // utterance; previousText is correction context only.
  const priorBuffer = getRevisionBuffer().text.trim();
  if (!getDictationSession().active) {
    startDictationSession();
  }

  appendDictationUtterance(utterance);
  // Capture the target app now, before hideOverlay()/typing changes focus —
  // Styles (P7.3) needs to know which app the text is actually going into.
  const processName = resolveTypingFocusTarget()?.processName;

  // P7.8 — take provisional typed-so-far before prepare/insert so we can
  // reconcile instead of double-inserting.
  const { takeStreamingProvisional, reconcileStreamingFinal } = await import(
    "./streamingInsert.js"
  );
  const streamSnap = takeStreamingProvisional();

  const { prepareComposeDictationText } = await import("./prepareComposeText.js");
  // Snippet match must use the *current* utterance, not an accumulated revision
  // buffer — otherwise "sig" never expands once prior text is in the buffer.
  const prepared = await prepareComposeDictationText(utterance, {
    surface: "dictation",
    processName,
    previousText: priorBuffer || undefined,
  });

  const confirmed = confirmDictationBuffer(prepared.text);
  if (!confirmed.text) {
    return { ok: false, mode: "dictation", error: "empty_buffer" };
  }

  // P7.5 — group this utterance into the ~20-min multi-utterance session window.
  recordSessionUtterance(confirmed.text, processName);
  const session = getSessionStatus();

  const shouldInsert = options?.insert !== false;
  if (!shouldInsert) {
    return {
      ok: true,
      mode: "dictation",
      finalText: confirmed.text,
      inserted: false,
      correctionKind: prepared.kind,
      session: session ?? undefined,
    };
  }

  try {
    // Restore the pinned app BEFORE hiding the overlay. hideOverlay used to
    // blur Ripple's main window, which handed FG to explorer and caused a
    // visible desktop flicker (insert_fg_shell_before_restore).
    await restoreFocusContext();
    hideOverlay();
    await new Promise((r) => setTimeout(r, 120));
    extendCommandFocusGrace();

    // P7.8 — if we already typed a provisional hypothesis, reconcile in place
    // (notes + OS). Skip the normal full insert when reconcile handled it.
    if (streamSnap && (streamSnap.provisional || streamSnap.surface === "note")) {
      const outcome = await reconcileStreamingFinal({
        finalText: confirmed.text,
        snap: streamSnap,
      });
      if (outcome === "noop" || outcome === "replaced") {
        logAndRecordLanguageTelemetry({
          intent: "dictation",
          ok: true,
          inserted: true,
          chars: confirmed.text.length,
          requestedLanguage: options?.requestedLanguage,
          detectedLanguage: options?.detectedLanguage,
          latencyMs: Date.now() - startedAt,
        });
        return {
          ok: true,
          mode: "dictation",
          finalText: confirmed.text,
          inserted: true,
          correctionKind: prepared.kind,
          session: session ?? undefined,
        };
      }
      // outcome === "inserted" → fall through to normal insert (e.g. WhatsApp skip)
    }

    // P10.1 — open Flow Note: append via notes store (never OS/WhatsApp insert).
    const { getActiveNoteId } = await import("../../state/activeNoteFocus.js");
    const noteId = getActiveNoteId();

    if (!noteId) {
      // Never re-resolve via mouse/memory when a hotkey pin already exists —
      // that silently swapped Chrome windows (WhatsApp → EGC Chat) mid-dictation.
      if (!hasDictationInsertTarget()) {
        const recovered = await recoverDictationFocusTarget("pre_insert");
        if (!recovered) {
          console.warn(
            "[ripple-desktop] dictation insert aborted — no focus target (click a field first)",
          );
          notifyDictationInsertFailure("no_focus_target");
          logAndRecordLanguageTelemetry({
            intent: "dictation",
            ok: false,
            inserted: false,
            chars: confirmed.text.length,
            requestedLanguage: options?.requestedLanguage,
            detectedLanguage: options?.detectedLanguage,
            latencyMs: Date.now() - startedAt,
          });
          return {
            ok: false,
            mode: "dictation",
            finalText: confirmed.text,
            inserted: false,
            correctionKind: prepared.kind,
            error: "no_focus_target",
            session: session ?? undefined,
          };
        }
      }
      if (!(await prepareDictationInsertFocus())) {
        console.warn(
          "[ripple-desktop] dictation insert aborted — could not restore pinned target",
        );
        notifyDictationInsertFailure("insert_aborted:restore_failed");
        logAndRecordLanguageTelemetry({
          intent: "dictation",
          ok: false,
          inserted: false,
          chars: confirmed.text.length,
          requestedLanguage: options?.requestedLanguage,
          detectedLanguage: options?.detectedLanguage,
          latencyMs: Date.now() - startedAt,
        });
        return {
          ok: false,
          mode: "dictation",
          finalText: confirmed.text,
          inserted: false,
          correctionKind: prepared.kind,
          error: "insert_aborted:restore_failed",
          session: session ?? undefined,
        };
      }
    }

    if (noteId) {
      const { getNote, updateNote } = await import("../../storage/notes.js");
      const existing = getNote(noteId);
      if (!existing) {
        throw new Error("active_note_missing");
      }
      const sep = existing.body && !/\s$/.test(existing.body) ? " " : "";
      const body = `${existing.body}${sep}${confirmed.text}`;
      const updated = updateNote(noteId, { body });
      if (!updated) throw new Error("note_update_failed");
      void import("../../sync/syncClient.js").then((m) =>
        m.pushSyncItemAsync("note", updated.id, {
          title: updated.title,
          body: updated.body,
          updatedAt: updated.updatedAt,
        }),
      );
      try {
        const { getMainWindow } = await import("../../windows/mainWindow.js");
        getMainWindow()?.webContents.send("notes:bodyAppended", {
          noteId: updated.id,
          body: updated.body,
        });
      } catch {
        /* best-effort UI refresh */
      }
      console.info(
        `[ripple-desktop] dictation → note ${noteId.slice(0, 8)} appended ${confirmed.text.length} chars`,
      );
    }

    const insertDetail = noteId
      ? undefined
      : await runInsertText({ text: confirmed.text });

    logAndRecordLanguageTelemetry({
      intent: "dictation",
      ok: true,
      inserted: true,
      chars: confirmed.text.length,
      requestedLanguage: options?.requestedLanguage,
      detectedLanguage: options?.detectedLanguage,
      latencyMs: Date.now() - startedAt,
      insertDetail,
    });
    return {
      ok: true,
      mode: "dictation",
      finalText: confirmed.text,
      inserted: true,
      correctionKind: prepared.kind,
      session: session ?? undefined,
    };
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : "dictation_insert_failed";
    notifyDictationInsertFailure(errMsg);
    logAndRecordLanguageTelemetry({
      intent: "dictation",
      ok: false,
      inserted: false,
      chars: confirmed.text.length,
      requestedLanguage: options?.requestedLanguage,
      detectedLanguage: options?.detectedLanguage,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      mode: "dictation",
      finalText: confirmed.text,
      inserted: false,
      correctionKind: prepared.kind,
      error: errMsg,
      session: session ?? undefined,
    };
  }
}

function notifyDictationInsertFailure(message: string): void {
  if (
    !/no_focus_target|wrong_insert_target|insert_aborted|insert_unverified|ripple_foreground|focus_not_editable|restore_failed/i.test(
      message,
    )
  ) {
    return;
  }
  let hint = "Click the target field, then dictate again";
  if (/restore_failed|could not restore/i.test(message)) {
    hint = "Couldn't reach the target window — click the field and try again";
  } else if (/wrong_insert_target/i.test(message)) {
    hint = "Focus Google Chat / WhatsApp first — text went to the wrong app";
  } else if (/ripple_foreground|keys_landed_in_ripple/i.test(message)) {
    hint = "Click your chat field — Ripple had focus";
  } else if (/focus_not_editable/i.test(message)) {
    hint = "Click inside the message box, then try again";
  }
  void import("../../windows/overlay.js").then(({ showDictationInsertFailure }) => {
    showDictationInsertFailure(hint);
  });
}
