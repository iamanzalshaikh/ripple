import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupWithinBounds,
  rewriteDictationBuffer,
} from "../dictation/dictationRewrite.js";
import type { CorrectionDecision } from "../dictation/dictationCorrectionTypes.js";
import { detectIntentAlternatives } from "../dictation/intentAlternatives.js";
import { applyCorrectionDecision } from "../dictation/safeRewriteEngine.js";

const {
  analyzeDictationCorrection,
  generateDictationCorrection,
  aiRewriteDictation,
} = vi.hoisted(() => ({
  analyzeDictationCorrection: vi.fn(),
  generateDictationCorrection: vi.fn(),
  aiRewriteDictation: vi.fn(async () => null),
}));

vi.mock("../dictation/aiRewriteDictation.js", () => ({
  isDictationAiRewriteEnabled: () => true,
  analyzeDictationCorrection,
  generateDictationCorrection,
  aiRewriteDictation,
}));

vi.mock("../../storage/voiceCorrections.js", () => ({
  applyCorrectionsToUtterance: (text: string) => text,
}));

function decision(
  overrides: Partial<CorrectionDecision>,
): CorrectionDecision {
  return {
    isCorrection: true,
    type: "replace",
    scope: "phrase",
    confidence: 0.96,
    original: null,
    replacement: null,
    rewriteInstruction: null,
    correctionReason: "unknown",
    reason: "eval decision",
    ...overrides,
  };
}

function analyzed(value: CorrectionDecision) {
  return { decision: value, model: "dictation-classifier-test" };
}

describe("P7.2 production correction eval corpus", () => {
  beforeEach(() => {
    analyzeDictationCorrection.mockReset();
    generateDictationCorrection.mockReset();
    aiRewriteDictation.mockReset();
    aiRewriteDictation.mockResolvedValue(null);
  });

  it("1 — safe double-no temporal replacement skips classifier", async () => {
    const result = await rewriteDictationBuffer({
      bufferText: "I will come today no no day after tomorrow",
    });
    expect(result.finalText).toBe("I will come the day after tomorrow");
    expect(result.decisionLog.layer2aCalled).toBe(false);
  });

  it("2 — normal 'no debt' meaning is preserved", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          isCorrection: false,
          type: "none",
          confidence: 0.98,
          reason: "no is ordinary sentence meaning",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({
      bufferText: "I have money, no debt at all",
    });
    expect(result.finalText).toBe("I have money, no debt at all.");
  });

  it("3 — single-no weekday correction uses classifier", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          original: "Monday",
          replacement: "Tuesday",
          correctionReason: "date_change",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({
      bufferText: "Meeting is Monday no Tuesday",
    });
    expect(result.finalText).toBe("Meeting is Tuesday");
  });

  it("4 — name replacement keeps command meaning", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          original: "John",
          replacement: "Michael",
          correctionReason: "name_change",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({
      bufferText: "Send email to John no send it to Michael",
    });
    expect(result.finalText).toBe("Send email to Michael");
  });

  it("5 — tone change calls classifier then generator", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          type: "tone_change",
          scope: "sentence",
          original: null,
          replacement: null,
          rewriteInstruction: "make it professional",
          correctionReason: "tone_adjustment",
          confidence: 0.9,
        }),
      ),
    );
    generateDictationCorrection.mockResolvedValueOnce({
      generation: {
        generatedText: "Please send the client update tomorrow.",
        droppedContent: [],
      },
      model: "dictation-generator-test",
    });
    const result = await rewriteDictationBuffer({
      committedBuffer: "Send the client update tomorrow.",
      bufferText: "Actually make it professional",
    });
    expect(result.finalText).toBe(
      "Please send the client update tomorrow.",
    );
    expect(result.decisionLog.layer2bCalled).toBe(true);
  });

  it("6 — delete last sentence is exact and scoped", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          type: "delete",
          scope: "sentence",
          confidence: 0.95,
          original: "Also bring the report.",
          replacement: null,
          correctionReason: "delete_content",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({
      committedBuffer: "I will join at 6pm. Also bring the report.",
      bufferText: "delete the last sentence",
    });
    expect(result.finalText).toBe("I will join at 6pm.");
  });

  it("7 — idiomatic 'No problem' skips classifier", async () => {
    const result = await rewriteDictationBuffer({
      bufferText: "No problem, I can wait",
    });
    expect(result.finalText).toBe("No problem, I can wait.");
    expect(analyzeDictationCorrection).not.toHaveBeenCalled();
  });

  it("8 — ordinary bare 'actually' skips classifier", async () => {
    const result = await rewriteDictationBuffer({
      bufferText: "it's actually pretty good so far",
    });
    expect(result.finalText).toBe("It's actually pretty good so far.");
    expect(analyzeDictationCorrection).not.toHaveBeenCalled();
  });

  it("9 — unavailable classifier preserves literal speech", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(null);
    const result = await rewriteDictationBuffer({
      bufferText: "Meeting is Monday no Tuesday",
    });
    // Classifier fail-open → local punct cleanup only (no surgical swap).
    expect(result.finalText).toBe("Meeting is Monday no Tuesday.");
    expect(result.decisionLog.modelUsed).toBe("local-cleanup-v1");
  });

  it("10 — unexplained generative truncation is rejected", async () => {
    const input =
      "I will join at 6pm because I have some work to finish first";
    const result = applyCorrectionDecision({
      committedBuffer: "",
      currentUtterance: input,
      signal: {
        detected: true,
        signal: "tone_directive",
        confidence: 0.9,
        requiresLLM: true,
      },
      decision: decision({
        type: "rewrite",
        scope: "full_buffer",
        confidence: 0.9,
        original: null,
        replacement: null,
        rewriteInstruction: "shorten",
        reason: "",
      }),
      generation: {
        generatedText: "I will join at 6pm.",
        droppedContent: [],
      },
    });
    expect(result.text).toBe(input);
    expect(result.reason).toBe("unexplained_length_drop");
  });

  it("11 — wait correction marker is classifier-resolved", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          original: "tomorrow",
          replacement: "Friday",
          correctionReason: "date_change",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({
      bufferText: "I will send the report tomorrow wait Friday",
    });
    expect(result.finalText).toBe("I will send the report Friday");
  });

  it("12 — sorry-make-that time correction is classifier-resolved", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          original: "5 PM",
          replacement: "6 PM",
          correctionReason: "time_change",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({
      bufferText: "Meeting at 5 PM sorry make that 6 PM",
    });
    expect(result.finalText).toBe("Meeting at 6 PM");
  });

  it("13 — filename correction uses exact replacement", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          original: "invoice_final",
          replacement: "invoice_v2",
          correctionReason: "word_replacement",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({
      bufferText:
        "Open the file called invoice_final, actually invoice_v2",
    });
    expect(result.finalText).toBe("Open the file called invoice_v2");
  });

  it("14 — embedded no-no is never locally auto-applied", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          isCorrection: false,
          type: "none",
          confidence: 0.9,
          reason: "no no is embedded in no one",
        }),
      ),
    );
    const input = "I don't know no no one told me";
    const result = await rewriteDictationBuffer({ bufferText: input });
    // Layer-1 must not surgically rewrite; localCleanup may tidy fillers/stutters.
    expect(result.decisionLog.layer1AutoApplied).toBe(false);
    expect(result.finalText.toLowerCase()).toContain("don't know");
    expect(result.finalText.toLowerCase()).toContain("one told me");
  });

  it("15 — time correction keeps the because-clause after restatement", async () => {
    const input =
      "Text me at 10 o'clock, no wait, just text me at 8.30 because I have some work to do and we will discuss and I will get back to you whenever I get free";
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          original: "10 o'clock",
          replacement: "8.30",
          correctionReason: "time_change",
          confidence: 0.9,
          reason: "The speaker corrected the time from 10 o'clock to 8.30.",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({ bufferText: input });
    expect(result.finalText).toBe(
      "Text me at 8.30 because I have some work to do and we will discuss and I will get back to you whenever I get free",
    );
    expect(result.decisionLog.applied).toBe(true);
  });

  it("17 — messy self-correction the classifier can't swap is cleaned always-on", async () => {
    const input =
      "Listen, can we meet tomorrow, no day after tomorrow. Let's meet and let's discuss. No, let's meet and we'll talk about this later";
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          isCorrection: true,
          type: "none",
          scope: "sentence",
          confidence: 0.8,
          reason: "the 'no' indicates a correction but no clean single swap",
        }),
      ),
    );
    aiRewriteDictation.mockResolvedValueOnce(
      "Listen, can we meet the day after tomorrow? Let's meet and talk about this later.",
    );
    const result = await rewriteDictationBuffer({ bufferText: input });
    expect(result.finalText).toBe(
      "Listen, can we meet the day after tomorrow? Let's meet and talk about this later.",
    );
    expect(result.decisionLog.applied).toBe(true);
    expect(result.decisionLog.reason).toMatch(/^ai_cleanup/);
    expect(result.decisionLog.modelUsed).toBe("dictation_clean");
  });

  it("18 — markerless clean speech is still lightly formatted", async () => {
    aiRewriteDictation.mockResolvedValueOnce(
      "Please review the deck before our call.",
    );
    const result = await rewriteDictationBuffer({
      bufferText: "please review the deck before our call",
    });
    expect(result.finalText).toBe("Please review the deck before our call.");
    expect(result.decisionLog.reason).toBe("ai_cleanup");
  });

  it("19 — cleanup that drops most content is rejected (fail-open to raw)", async () => {
    const input =
      "so basically what I wanted to say is that we should probably meet sometime next week to go over the numbers together";
    aiRewriteDictation.mockResolvedValueOnce("Let's meet.");
    const result = await rewriteDictationBuffer({ bufferText: input });
    // Aggressive AI rewrite rejected; localCleanup may still lightly tidy.
    expect(result.finalText).not.toBe("Let's meet.");
    expect(result.decisionLog.reason).not.toMatch(/^ai_cleanup/);
    expect(result.finalText.toLowerCase()).toContain("next week");
  });

  it("19b — cleanup that deletes a greeting+name clause is rejected (live WhatsApp bug)", async () => {
    const input = "Hello Tathir, How are you? Can we meet at 10 o'clock";
    aiRewriteDictation.mockResolvedValueOnce("Can we meet at 10 o'clock?");
    const result = await rewriteDictationBuffer({ bufferText: input });
    expect(result.finalText).toMatch(/Hello Tathir/i);
    expect(result.finalText).toMatch(/How are you/i);
    expect(result.decisionLog.reason).not.toMatch(/^ai_cleanup/);
  });

  it("19c — light punctuation cleanup that keeps greeting+name is accepted", async () => {
    const input = "Hello Tathir, How are you? Can we meet at 10 o'clock";
    aiRewriteDictation.mockResolvedValueOnce(
      "Hello Tathir, how are you? Can we meet at 10 o'clock?",
    );
    const result = await rewriteDictationBuffer({ bufferText: input });
    expect(result.finalText).toBe(
      "Hello Tathir, how are you? Can we meet at 10 o'clock?",
    );
    expect(result.decisionLog.reason).toBe("ai_cleanup");
  });

  it("19d — cleanupWithinBounds rejects greeting drop without correction marker", () => {
    expect(
      cleanupWithinBounds(
        "Hello Tathir, How are you? Can we meet at 10 o'clock",
        "Can we meet at 10 o'clock?",
      ),
    ).toBe(false);
    expect(
      cleanupWithinBounds(
        "Hey, how are you? I want to meet you at 9 o'clock tomorrow.",
        "I want to meet you at 9 o'clock the day after tomorrow. Are you free?",
      ),
    ).toBe(false);
    expect(
      cleanupWithinBounds(
        "Hello Tathir, How are you? Can we meet at 10 o'clock",
        "Hello Tathir, how are you? Can we meet at 10 o'clock?",
      ),
    ).toBe(true);
  });

  it("19e — detectIntentAlternatives finds competing greetings/times/offers", () => {
    expect(
      detectIntentAlternatives(
        "Hello Sir, Good Morning, Good Afternoon, How are you?",
      ).kind,
    ).toBe("greeting_tod");
    expect(
      detectIntentAlternatives(
        "Can we meet for a coffee, can we for a tea this evening at 9, 10 pm",
      ).detected,
    ).toBe(true);
    expect(
      detectIntentAlternatives(
        "Hello Tathir, how are you? Can we meet at 10 o'clock?",
      ).detected,
    ).toBe(false);
  });

  it("19f — allowAlternativeCollapse accepts TOD greeting collapse; still blocks name drop", () => {
    // Multiple sentence clauses so default bounds reject clause drop;
    // allowAlternativeCollapse is what unlocks the Wispr-style collapse.
    const src = "Hello Sir, Good Morning. Good Afternoon. How are you?";
    const collapsed = "Hello Sir, good afternoon. How are you?";
    expect(cleanupWithinBounds(src, collapsed)).toBe(false);
    expect(
      cleanupWithinBounds(src, collapsed, { allowAlternativeCollapse: true }),
    ).toBe(true);
    expect(
      cleanupWithinBounds(src, "Good afternoon. How are you?", {
        allowAlternativeCollapse: true,
      }),
    ).toBe(false);
  });

  it("19g — alt-collapse path accepts AI cleanup for competing greetings", async () => {
    aiRewriteDictation.mockResolvedValueOnce(
      "Hello Sir, good afternoon. How are you?",
    );
    const result = await rewriteDictationBuffer({
      bufferText: "Hello Sir, Good Morning. Good Afternoon. How are you?",
    });
    expect(result.finalText).toBe("Hello Sir, good afternoon. How are you?");
    expect(result.decisionLog.reason).toBe("ai_cleanup+alt_greeting_tod");
  });

  it("20 — cleanup is skipped after a successful surgical correction", async () => {
    analyzeDictationCorrection.mockResolvedValueOnce(
      analyzed(
        decision({
          original: "Monday",
          replacement: "Tuesday",
          correctionReason: "date_change",
        }),
      ),
    );
    const result = await rewriteDictationBuffer({
      bufferText: "Meeting is Monday no Tuesday",
    });
    expect(result.finalText).toBe("Meeting is Tuesday");
    expect(aiRewriteDictation).not.toHaveBeenCalled();
  });

  it("16 — replace that would leave only a stub is rejected by length guard", () => {
    const input =
      "Text me at 10 o'clock because I have some work to do and we will discuss later";
    const result = applyCorrectionDecision({
      committedBuffer: "",
      currentUtterance: input,
      signal: {
        detected: true,
        signal: "single_no",
        confidence: 0.7,
        requiresLLM: true,
        // No marker → fall through to naive replaceLast which keeps the clause
      },
      decision: decision({
        original: "10 o'clock because I have some work to do and we will discuss later",
        replacement: "8.30",
        confidence: 0.9,
      }),
    });
    // Naive replaceLast of almost the whole sentence → stub; length guard rejects.
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("unexplained_length_drop");
    expect(result.text).toBe(input);
  });
});
