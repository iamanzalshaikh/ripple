import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareComposeDictationText } from "../dictation/prepareComposeText.js";

vi.mock("../../storage/voiceCorrections.js", () => ({
  applyCorrectionsToUtterance: (text: string) => text,
}));

const { analyzeDictationCorrection, generateDictationCorrection } = vi.hoisted(
  () => ({
    analyzeDictationCorrection: vi.fn(),
    generateDictationCorrection: vi.fn(),
  }),
);

vi.mock("../dictation/aiRewriteDictation.js", () => ({
  isDictationAiRewriteEnabled: () => true,
  aiRewriteDictation: vi.fn(async () => null),
  analyzeDictationCorrection,
  generateDictationCorrection,
}));

describe("prepareComposeDictationText AI layer", () => {
  beforeEach(() => {
    analyzeDictationCorrection.mockReset();
    generateDictationCorrection.mockReset();
  });

  // NOTE (latency loop #3): a comma-delimited "no" between two TEMPORAL tokens
  // ("meet at 9pm, no, 10pm") is now resolved locally, with no classifier call
  // — same corrected text, ~1.5 s cheaper. These two tests therefore use a
  // NON-temporal correction, which still requires the classifier, so both
  // original contracts stay genuinely covered. The local path has its own
  // coverage in dictation/__tests__/latencyLlmSkips.spec.ts.
  it("uses structured correction decision when available", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce({
      decision: {
        isCorrection: true,
        type: "replace",
        scope: "phrase",
        confidence: 0.97,
        original: "blue folder",
        replacement: "red folder",
        rewriteInstruction: null,
        correctionReason: "target_change",
        reason: "user revised the folder",
      },
      model: "test-classifier",
    });
    const out = await prepareComposeDictationText(
      "Put it in the blue folder, no, the red folder",
      { surface: "whatsapp" },
    );
    expect(out.aiUsed).toBe(true);
    expect(out.text.toLowerCase()).toContain("red folder");
    expect(out.text.toLowerCase()).not.toMatch(/\bno\b/);
    expect(analyzeDictationCorrection).toHaveBeenCalledOnce();
  });

  it("preserves literal speech when classifier is unavailable", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(null);
    const out = await prepareComposeDictationText(
      "Put it in the blue folder, no, the red folder",
    );
    expect(out.aiUsed).toBe(false);
    expect(out.text).toBe("Put it in the blue folder, no, the red folder.");
  });

  it("temporal 'no' correction needs no classifier at all (latency #3)", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(null);
    const out = await prepareComposeDictationText(
      "Meet tomorrow, no, day after tomorrow at 8 o'clock",
    );
    // Resolved locally to the user's actual intent...
    expect(out.text.toLowerCase()).toContain("day after tomorrow");
    expect(out.text.toLowerCase()).not.toMatch(/\bno\b/);
    // ...without paying for the LLM round trip.
    expect(analyzeDictationCorrection).not.toHaveBeenCalled();
    expect(out.aiUsed).toBe(false);
  });
});
