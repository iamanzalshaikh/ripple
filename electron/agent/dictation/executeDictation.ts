import { hideOverlay } from "../../windows/overlay.js";
import { runInsertText } from "../../automation/actions/insertText.js";
import { processTranscriptFromStt } from "../../automation/voice/transcriptPipeline.js";
import {
  appendDictationUtterance,
  confirmDictationBuffer,
  getDictationSession,
  getRevisionBuffer,
  startDictationSession,
} from "./dictationSession.js";

export type DictationExecuteResult = {
  ok: boolean;
  mode: "dictation";
  finalText?: string;
  inserted?: boolean;
  error?: string;
  correctionKind?: string;
};

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
  options?: { insert?: boolean },
): Promise<DictationExecuteResult> {
  const utterance = dictationUtteranceFromStt(rawTranscript);
  if (!utterance) {
    return { ok: false, mode: "dictation", error: "no_speech" };
  }

  if (!getDictationSession().active) {
    startDictationSession();
  }

  appendDictationUtterance(utterance);
  const { prepareComposeDictationText } = await import("./prepareComposeText.js");
  const prepared = await prepareComposeDictationText(getRevisionBuffer().text, {
    surface: "dictation",
  });

  const confirmed = confirmDictationBuffer(prepared.text);
  if (!confirmed.text) {
    return { ok: false, mode: "dictation", error: "empty_buffer" };
  }

  const shouldInsert = options?.insert !== false;
  if (!shouldInsert) {
    return {
      ok: true,
      mode: "dictation",
      finalText: confirmed.text,
      inserted: false,
      correctionKind: prepared.kind,
    };
  }

  try {
    hideOverlay();
    await new Promise((r) => setTimeout(r, 120));
    await runInsertText({ text: confirmed.text });
    return {
      ok: true,
      mode: "dictation",
      finalText: confirmed.text,
      inserted: true,
      correctionKind: prepared.kind,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      mode: "dictation",
      finalText: confirmed.text,
      inserted: false,
      correctionKind: prepared.kind,
      error: e instanceof Error ? e.message : "dictation_insert_failed",
    };
  }
}
