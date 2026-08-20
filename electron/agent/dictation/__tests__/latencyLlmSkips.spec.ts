import { describe, expect, it } from "vitest";
import { detectCorrectionSignal } from "../correctionSignalDetector.js";

/**
 * Latency checklist #3 — "cleaned=0" must not burn a ~1.5 s Layer2a LLM call on
 * a correction we can resolve locally, and must not leave "No, 10pm" sitting in
 * the user's message.
 *
 * The guard rails matter as much as the win: a bare "no" is ordinary speech and
 * must still go to the LLM rather than being mangled into a temporal swap.
 */
describe("Latency #3 — local resolution of single_no temporal swaps", () => {
  const detect = (currentUtterance: string, committedBuffer = "") =>
    detectCorrectionSignal({ currentUtterance, committedBuffer });

  it("resolves 'meet at 9pm, no, 10pm' locally with NO llm call", () => {
    const s = detect("let's meet at 9pm, no, 10pm");
    expect(s.signal).toBe("single_no");
    expect(s.requiresLLM).toBe(false);
    expect(s.candidate).toBeTruthy();
    expect(s.candidate?.type).toBe("replace");
    expect(s.candidate?.original).toBe("9pm");
    expect(s.candidate?.replacement).toBe("10pm");
  });

  it("resolves a day swap locally too", () => {
    const s = detect("call me tuesday, no, wednesday");
    expect(s.requiresLLM).toBe(false);
    expect(s.candidate?.original?.toLowerCase()).toBe("tuesday");
    expect(s.candidate?.replacement?.toLowerCase()).toBe("wednesday");
  });

  // ---- guard rails: these must STILL go to the LLM, unchanged ----

  it("a bare 'no' in ordinary speech is NOT turned into a swap", () => {
    // Both sides contain a time, so only adjacency protects us here: the
    // temporal is far to the left with "there is" between it and the "no",
    // marking "no" as negating a noun rather than retracting the time.
    const s = detect("at 2pm there is no 3pm option");
    expect(s.candidate).toBeFalsy();
    // Since the production filter landed this is now recognised as ordinary
    // speech and skipped outright, rather than costing an LLM round trip to
    // reach the same conclusion.
    expect(s.requiresLLM).toBe(false);
    expect(s.observation).toBe("determiner_no_filtered");
  });

  it("'no' with no temporal on both sides still goes to the LLM", () => {
    const s = detect("tell him no, that plan");
    expect(s.candidate).toBeFalsy();
    expect(s.requiresLLM).toBe(true);
  });

  it("a negation without commas is untouched", () => {
    const s = detect("we have no slots left today");
    expect(s.candidate).toBeFalsy();
  });

  it("a long tail is not treated as a clean replacement", () => {
    const s = detect(
      "meet at 9pm, no, 10pm would be better for everyone involved honestly ok",
    );
    expect(s.candidate).toBeFalsy();
    expect(s.requiresLLM).toBe(true);
  });

  it("double_no behaviour is unchanged", () => {
    const s = detect("meet at 9pm, no no, 10pm");
    expect(s.requiresLLM).toBe(false);
    expect(s.candidate?.replacement).toBe("10pm");
  });
});
