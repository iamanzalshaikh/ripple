import { rewriteDictationBuffer } from "./dictationRewrite.js";
import { biasUtteranceFromScreen } from "./screenNameBias.js";

export type PreparedComposeText = {
  text: string;
  kind: string;
  aiUsed?: boolean;
};

/**
 * P7.2 / P7.4 — production correction pipeline followed by personal memory.
 * P7.7 — nearby on-screen text biases name/term spelling before cleanup.
 * The orchestrator fails open to literal speech when classification fails.
 */
export async function prepareComposeDictationText(
  raw: string,
  options?: { surface?: string; previousText?: string; processName?: string },
): Promise<PreparedComposeText> {
  let bufferText = raw.trim();

  // P7.7 — Mechanism 1 (Wispr context awareness): bias STT tokens toward
  // names/terms already visible near the cursor. Runs before dictionary +
  // cleanup so screen-correct spellings are protected like nor→Noor.
  try {
    const biased = await biasUtteranceFromScreen(bufferText);
    if (biased.replacements.length > 0) {
      console.info(
        `[ripple-screen-bias] surface=${options?.surface ?? "dictation"} ` +
          `terms=${biased.terms.length} fixes=${biased.replacements
            .map((r) => `${r.from}→${r.to}`)
            .join(", ")}`,
      );
      bufferText = biased.text;
    }
  } catch {
    /* fail-open — leave bufferText unchanged */
  }

  const { maintainPinnedTargetDuringRewrite } = await import(
    "../../focus/focusContext.js"
  );
  await maintainPinnedTargetDuringRewrite();

  const rewritten = await rewriteDictationBuffer({
    bufferText,
    committedBuffer: options?.previousText,
    applyMemoryCorrections: true,
    processName: options?.processName,
  });

  await maintainPinnedTargetDuringRewrite();

  return {
    text: rewritten.finalText,
    kind: rewritten.kind,
    aiUsed:
      rewritten.decisionLog.modelUsed !== "none_fallback" &&
      (rewritten.decisionLog.layer2aCalled ||
        rewritten.decisionLog.layer2bCalled),
  };
}
