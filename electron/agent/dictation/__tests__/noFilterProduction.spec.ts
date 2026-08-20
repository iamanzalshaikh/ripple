import { describe, expect, it } from "vitest";
import { detectCorrectionSignal } from "../correctionSignalDetector.js";

/**
 * Production filter for the word "no".
 *
 * Live 2026-08-20 (real WhatsApp dictation): the utterance
 *   "…suppose if there is no Stack, it will show no Stack in application…"
 * was classified `single_no`, which forced a Layer2a LLM call costing
 * **3106 ms** — only for the classifier to answer "'no Stack' … is a normal
 * sentence meaning" — plus a 1.2 s aborted rewrite on top.
 *
 * Grammatically: a *determiner* "no" attaches straight to the noun it negates
 * and never takes a comma ("no stack"). A *retraction* "no" is delimited by a
 * pause, introduces a repair cue, or sits between two restatements.
 */
describe("production 'no' filter — determiner vs retraction", () => {
  const detect = (currentUtterance: string, committedBuffer = "") =>
    detectCorrectionSignal({ currentUtterance, committedBuffer });

  describe("ordinary speech must NEVER call the LLM", () => {
    // The exact sentence from the live log that cost 3.1 s.
    it("the real 614-char dictation that cost 3106ms", () => {
      const s = detect(
        "In application, we need to add this, suppose if the Stack is out of order, " +
          "suppose if there is no Stack, it will show no Stack in application, and " +
          "suppose if there is, at that, Restaurant is closed, so it should show the " +
          "Restaurant is closed, just add that Feature, Inventory indicator one",
      );
      expect(s.requiresLLM).toBe(false);
      expect(s.detected).toBe(false);
      expect(s.observation).toBe("determiner_no_filtered");
    });

    it.each([
      "there is no stack",
      "we have no slots left today",
      "it will show no stack in application",
      "the user has no permission to do that",
      "there is no way to confirm this",
      "I have no idea what happened",
      "no problem I will handle it",
      "he said no one showed up",
      "that is no longer supported",
      "it makes no sense to me",
      "no worries take your time",
      "there is no doubt about it",
    ])("does not escalate: %j", (utterance) => {
      const s = detect(utterance);
      expect(s.requiresLLM).toBe(false);
    });

    it("a long dictation with numbers elsewhere is not faked into a match", () => {
      // "27" is a TEMPORAL-shaped token; it must not turn a determiner "no"
      // into a retraction just by existing somewhere in the sentence.
      const s = detect(
        "if there is no stack we skip it, and about 27 point chicken we can add later",
      );
      expect(s.requiresLLM).toBe(false);
    });
  });

  describe("real retractions must STILL be caught", () => {
    it("comma-delimited retraction resolves locally", () => {
      const s = detect("let's meet at 9pm, no, 10pm");
      expect(s.signal).toBe("single_no");
      expect(s.requiresLLM).toBe(false); // resolved locally, not dropped
      expect(s.candidate?.replacement).toBe("10pm");
    });

    it.each([
      "send it to the blue folder, no the red folder",
      "call him at 5, no wait, at 6",
      "book it for monday, no sorry tuesday",
      "tell her yes, no actually tell her no comment",
    ])("still treats as a correction: %j", (utterance) => {
      const s = detect(utterance);
      expect(s.signal).not.toBe("none");
    });

    it("same-category restatement without a comma is still a retraction", () => {
      const s = detect("meeting is monday no tuesday");
      expect(s.signal).not.toBe("none");
    });

    it("double no is unchanged", () => {
      const s = detect("meet at 9pm, no no, 10pm");
      expect(s.requiresLLM).toBe(false);
      expect(s.candidate?.replacement).toBe("10pm");
    });

    it("actually-no is unchanged", () => {
      const s = detect("send it tuesday, actually no, wednesday");
      expect(s.signal).not.toBe("none");
    });
  });

  describe("other directives are untouched", () => {
    it.each([
      ["make it more professional", "tone_directive"],
      ["scratch that", "scratch_that"],
    ])("%j still routes as %s", (utterance, signal) => {
      expect(detect(utterance).signal).toBe(signal);
    });

    it("clean speech with no marker stays clean", () => {
      const s = detect("hello how are you doing today");
      expect(s.signal).toBe("none");
      expect(s.requiresLLM).toBe(false);
    });
  });
});

/**
 * Regression for the live 2026-08-20 failure: the filter correctly flagged
 * "at 9, no 10 pm" as a retraction, but the RESOLVER demanded a comma on both
 * sides (", no,"). Real speech only has the leading comma, so every genuine
 * correction fell through to Layer2a — which cost 1.9–4.1 s and then returned
 * no replacement, leaving "no 10 pm" in the user's message.
 */
describe("resolver — real spoken retraction forms", () => {
  const detect = (currentUtterance: string) =>
    detectCorrectionSignal({ currentUtterance, committedBuffer: "" });

  it("'Let's meet Tomorrow at 9, no 10 pm' resolves locally", () => {
    const s = detect("Let's meet Tomorrow at 9, no 10 pm");
    expect(s.requiresLLM).toBe(false);
    expect(s.candidate?.original).toBe("9");
    expect(s.candidate?.replacement).toBe("10 pm");
  });

  it("'Transmit tomorrow at 9, no 10 pm' resolves locally", () => {
    const s = detect("Transmit tomorrow at 9, no 10 pm");
    expect(s.requiresLLM).toBe(false);
    expect(s.candidate?.replacement).toBe("10 pm");
  });

  it.each([
    "call me at 5, no 6",
    "the meeting is monday, no tuesday",
    "let's do 9am, no 10am",
  ])("no trailing comma still resolves: %j", (utterance) => {
    const s = detect(utterance);
    expect(s.requiresLLM).toBe(false);
    expect(s.candidate).toBeTruthy();
  });

  it("still refuses when there is no temporal on both sides", () => {
    const s = detect("send it to john, no the other one");
    expect(s.candidate).toBeFalsy();
  });

  it("determiner 'no' is still filtered out entirely", () => {
    const s = detect("there is no stack at 9 pm today");
    expect(s.requiresLLM).toBe(false);
    expect(s.observation).toBe("determiner_no_filtered");
  });
});
