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

vi.mock("../dictation/aiRewriteDictation.js", () => ({
  isDictationAiRewriteEnabled: () => false,
  aiRewriteDictation: vi.fn(async () => null),
  analyzeDictationCorrection: vi.fn(async () => null),
  generateDictationCorrection: vi.fn(async () => null),
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

  it("revises comma-anchored single 'no' self-correction", () => {
    const result = applyCorrectionHeuristics(
      "Meet tomorrow, no day after tomorrow at 9 o'clock",
    );
    expect(result.kind).toBe("replace_tail");
    expect(result.text.toLowerCase()).toContain("day after tomorrow");
    expect(result.text.toLowerCase()).toContain("9 o'clock");
    expect(result.text.toLowerCase()).not.toMatch(/tomorrow,\s*no\b/);
  });

  it("revises live ASR 'tomorrow, no, day after' with comma after no", () => {
    const result = applyCorrectionHeuristics(
      "Meet tomorrow, no, day after tomorrow at 8 o'clock",
    );
    expect(result.kind).toBe("replace_tail");
    expect(result.text.toLowerCase()).toContain("day after tomorrow");
    expect(result.text.toLowerCase()).toContain("8 o'clock");
    expect(result.text.toLowerCase()).not.toMatch(/\bno\b/);
    expect(result.text.toLowerCase()).not.toMatch(/meet tomorrow/);
  });

  it("revises 'Monday no Tuesday' weekday swap", () => {
    const result = applyCorrectionHeuristics(
      "Send the report Monday no Tuesday",
    );
    expect(result.kind).toBe("replace_tail");
    expect(result.text.toLowerCase()).toContain("tuesday");
    expect(result.text.toLowerCase()).not.toContain("monday");
  });

  it("revises 'tomorrow no Friday' day swap", () => {
    const result = applyCorrectionHeuristics(
      "Call Rahul tomorrow no Friday",
    );
    expect(result.kind).toBe("replace_tail");
    expect(result.text.toLowerCase()).toContain("friday");
    expect(result.text.toLowerCase()).toContain("rahul");
    expect(result.text.toLowerCase()).not.toContain("tomorrow");
  });

  it("revises clause when shared phrase restarts after no", () => {
    const result = applyCorrectionHeuristics(
      "I will tell you one thing, just text me at 9 o'clock, no, just text me at 10",
    );
    expect(result.kind).toBe("replace_tail");
    expect(result.text.toLowerCase()).toContain("10");
    expect(result.text.toLowerCase()).toContain("one thing");
    expect(result.text.toLowerCase()).not.toMatch(/9\s*o/);
    expect(result.text.toLowerCase()).not.toMatch(/\bno\b/);
  });

  it("does not treat 'money, no debt' as a self-correction", () => {
    const result = applyCorrectionHeuristics("I have money, no debt at all");
    expect(result.kind).not.toBe("replace_tail");
    expect(result.text.toLowerCase()).toContain("money");
    expect(result.text.toLowerCase()).toContain("debt");
  });

  it("does not duplicate articles in legacy fallback", () => {
    const result = applyCorrectionHeuristics(
      "meet at the office, no, the cafe",
    );
    expect(result.text).not.toMatch(/\bthe\s+the\b/i);
  });

  it("deletes a spoken phrase", () => {
    const result = applyCorrectionHeuristics(
      "See you tomorrow remove tomorrow",
    );
    expect(result.kind).toBe("delete_phrase");
    expect(result.text.toLowerCase()).not.toContain("tomorrow");
    expect(result.text.toLowerCase()).toContain("see you");
  });

  it("legacy delete removes only the last matching occurrence", () => {
    const result = applyCorrectionHeuristics(
      "tomorrow is better than tomorrow remove tomorrow",
    );
    expect(result.text.match(/\btomorrow\b/gi)).toHaveLength(1);
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

  it("session buffer confirms only after rewrite", async () => {
    startDictationSession();
    appendDictationUtterance("hello tomorrow");
    expect(getRevisionBuffer().confirmed).toBe(false);
    const rewritten = await rewriteDictationBuffer({
      bufferText: getRevisionBuffer().text + " no no day after tomorrow",
    });
    const confirmed = confirmDictationBuffer(rewritten.finalText);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.text.toLowerCase()).toContain("day after tomorrow");
  });

  it("applies P6 memory corrections (her rides → HerRidez)", async () => {
    const out = await rewriteDictationBuffer({
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
