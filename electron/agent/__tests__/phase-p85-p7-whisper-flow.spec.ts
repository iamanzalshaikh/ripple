import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCorrectionHeuristics,
  replaceOverlappingTail,
} from "../dictation/correctionEngine.js";
import { rewriteDictationBuffer } from "../dictation/dictationRewrite.js";
import {
  appendDictationUtterance,
  cancelDictationSession,
  confirmDictationBuffer,
  getRevisionBuffer,
  resetDictationSessionForTests,
  startDictationSession,
} from "../dictation/dictationSession.js";

vi.mock("../../storage/voiceCorrections.js", () => ({
  applyCorrectionsToUtterance: (text: string) =>
    text.replace(/\bher rides\b/gi, "HerRidez"),
}));

vi.mock("../../automation/actions/insertText.js", () => ({
  runInsertText: vi.fn(async () => "typed"),
}));

vi.mock("../../windows/overlay.js", () => ({
  hideOverlay: vi.fn(),
}));

describe("P8.5-P7 Whisper Flow", () => {
  beforeEach(() => {
    resetDictationSessionForTests();
  });

  afterEach(() => {
    resetDictationSessionForTests();
    vi.clearAllMocks();
  });

  it("revises tomorrow → day after tomorrow without typing interim scraps", () => {
    const result = applyCorrectionHeuristics(
      "I want to meet you tomorrow. no no. day after tomorrow",
    );
    expect(result.kind).toBe("replace_tail");
    expect(result.text.toLowerCase()).toContain("day after tomorrow");
    expect(result.text.toLowerCase()).not.toMatch(/tomorrow\.?\s+no/);
    expect(result.text.toLowerCase()).toMatch(/meet you/);
  });

  it("handles ASR noo noo variant from the demo script", () => {
    const result = applyCorrectionHeuristics(
      "I want to meet you tomorrow. noo noo. on day after tomorrow.",
    );
    expect(result.text.toLowerCase()).toContain("day after tomorrow");
    expect(result.text.toLowerCase()).not.toContain("noo");
  });

  it("deletes a spoken phrase", () => {
    const result = applyCorrectionHeuristics(
      "See you tomorrow remove tomorrow",
    );
    expect(result.kind).toBe("delete_phrase");
    expect(result.text.toLowerCase()).not.toContain("tomorrow");
    expect(result.text.toLowerCase()).toContain("see you");
  });

  it("makes professional tone", () => {
    const result = applyCorrectionHeuristics(
      "hey gotta ship this make it professional",
    );
    expect(result.kind).toBe("tone_rewrite");
    expect(result.text.toLowerCase()).toContain("need to");
    expect(result.text.startsWith("H") || result.text.startsWith("I")).toBe(
      true,
    );
  });

  it("session buffer confirms only after rewrite", () => {
    startDictationSession();
    appendDictationUtterance("hello tomorrow");
    expect(getRevisionBuffer().confirmed).toBe(false);
    const rewritten = rewriteDictationBuffer({
      bufferText: getRevisionBuffer().text + " no no day after tomorrow",
    });
    const confirmed = confirmDictationBuffer(rewritten.finalText);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.text.toLowerCase()).toContain("day after tomorrow");
  });

  it("applies P6 memory corrections (her rides → HerRidez)", () => {
    const out = rewriteDictationBuffer({
      bufferText: "open her rides folder please",
      applyMemoryCorrections: true,
    });
    expect(out.finalText).toContain("HerRidez");
  });

  it("cancel clears buffer and does not leave confirmed text", () => {
    startDictationSession();
    appendDictationUtterance("do not type this");
    cancelDictationSession();
    expect(getRevisionBuffer().text).toBe("");
    expect(getRevisionBuffer().confirmed).toBe(false);
  });

  it("executeDictation inserts final text only (mocked ladder)", async () => {
    const { runInsertText } = await import(
      "../../automation/actions/insertText.js"
    );
    const { executeDictationUtterance } = await import(
      "../dictation/executeDictation.js"
    );
    startDictationSession();
    const res = await executeDictationUtterance(
      "I want to meet you tomorrow no no day after tomorrow",
      { insert: true },
    );
    expect(res.ok).toBe(true);
    expect(res.inserted).toBe(true);
    expect(res.finalText?.toLowerCase()).toContain("day after tomorrow");
    expect(runInsertText).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runInsertText).mock.calls[0]?.[0] as {
      text?: string;
    };
    expect(arg.text?.toLowerCase()).toContain("day after tomorrow");
    expect(arg.text?.toLowerCase()).not.toMatch(/no no/);
  });

  it("replaceOverlappingTail prefers day-after rewrite", () => {
    expect(
      replaceOverlappingTail(
        "I want to meet you tomorrow",
        "day after tomorrow",
      ).toLowerCase(),
    ).toContain("the day after tomorrow");
  });
});
