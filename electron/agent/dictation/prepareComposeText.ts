import { rewriteDictationBuffer } from "./dictationRewrite.js";
import { biasUtteranceFromScreen } from "./screenNameBias.js";
import { applyDevModeText } from "./devModeText.js";

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
  const { resolvePipelineLayers } = await import("./pipelineLayers.js");
  const layers = await resolvePipelineLayers();

  // P7.7 — context layer: bias STT tokens toward names/terms already visible.
  if (layers.context) {
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
  }

  const { maintainPinnedTargetDuringRewrite } = await import(
    "../../focus/focusContext.js"
  );
  await maintainPinnedTargetDuringRewrite();

  // Tag files / camelCase symbols before cleanup so High rewrite cannot
  // erase "is login error" / filenames. Insert and focus are unchanged.
  const beforeRewrite = await applyDevModeText(bufferText, {
    processName: options?.processName,
  });
  bufferText = beforeRewrite.text;

  const rewritten = await rewriteDictationBuffer({
    bufferText,
    committedBuffer: options?.previousText,
    applyMemoryCorrections: true,
    processName: options?.processName,
    layers,
  });

  await maintainPinnedTargetDuringRewrite();

  const afterRewrite = await applyDevModeText(rewritten.finalText, {
    processName: options?.processName,
  });

  const model = rewritten.decisionLog.modelUsed;
  const localOnly =
    model.startsWith("local-") || model === "snippet" || model === "none_fallback";

  return {
    text: afterRewrite.text,
    kind: rewritten.kind,
    aiUsed: !localOnly && rewritten.decisionLog.applied,
  };
}
