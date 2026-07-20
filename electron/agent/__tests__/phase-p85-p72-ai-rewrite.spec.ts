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

  it("uses structured correction decision when available", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce({
      decision: {
        isCorrection: true,
        type: "replace",
        scope: "phrase",
        confidence: 0.97,
        original: "tomorrow",
        replacement: "day after tomorrow at 8 o'clock",
        rewriteInstruction: null,
        correctionReason: "date_change",
        reason: "user revised date",
      },
      model: "test-classifier",
    });
    const out = await prepareComposeDictationText(
      "Meet tomorrow, no, day after tomorrow at 8 o'clock",
      { surface: "whatsapp" },
    );
    expect(out.aiUsed).toBe(true);
    expect(out.text.toLowerCase()).toContain("day after tomorrow");
    expect(out.text.toLowerCase()).not.toMatch(/\bno\b/);
    expect(analyzeDictationCorrection).toHaveBeenCalledOnce();
  });

  it("preserves literal speech when classifier is unavailable", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(null);
    const out = await prepareComposeDictationText(
      "Meet tomorrow, no, day after tomorrow at 8 o'clock",
    );
    expect(out.aiUsed).toBe(false);
    expect(out.text).toBe(
      "Meet tomorrow, no, day after tomorrow at 8 o'clock",
    );
  });
});
