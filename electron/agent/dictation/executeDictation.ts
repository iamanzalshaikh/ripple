import { hideOverlay } from "../../windows/overlay.js";
import { runInsertText } from "../../automation/actions/insertText.js";
import { processTranscriptFromStt } from "../../automation/voice/transcriptPipeline.js";
import { resolveTypingFocusTarget } from "../../focus/focusContext.js";
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
}): void {
  console.info(
    `[ripple-insert-lang] surface=${args.intent} requested=${args.requestedLanguage ?? "auto"} ` +
      `detected=${args.detectedLanguage ?? "?"} chars=${args.chars} inserted=${args.inserted}`,
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
    hideOverlay();
    await new Promise((r) => setTimeout(r, 120));
    await runInsertText({ text: confirmed.text });
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
  } catch (e: unknown) {
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
      error: e instanceof Error ? e.message : "dictation_insert_failed",
      session: session ?? undefined,
    };
  }
}
