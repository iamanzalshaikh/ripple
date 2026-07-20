import { rewriteDictationBuffer } from "./dictationRewrite.js";

export type PreparedComposeText = {
  text: string;
  kind: string;
  aiUsed?: boolean;
};

/**
 * P7.2 / P7.4 — production correction pipeline followed by personal memory.
 * The orchestrator fails open to literal speech when classification fails.
 */
export async function prepareComposeDictationText(
  raw: string,
  options?: { surface?: string; previousText?: string },
): Promise<PreparedComposeText> {
  const rewritten = await rewriteDictationBuffer({
    bufferText: raw.trim(),
    committedBuffer: options?.previousText,
    applyMemoryCorrections: true,
  });
  return {
    text: rewritten.finalText,
    kind: rewritten.kind,
    aiUsed:
      rewritten.decisionLog.modelUsed !== "none_fallback" &&
      (rewritten.decisionLog.layer2aCalled ||
        rewritten.decisionLog.layer2bCalled),
  };
}
