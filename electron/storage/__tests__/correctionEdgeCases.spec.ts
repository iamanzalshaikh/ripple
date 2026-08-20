import { beforeEach, describe, expect, it } from "vitest";
import { openRippleDbInMemoryForTests } from "../rippleDb.js";
import {
  applyCorrectionsToUtterance,
  learnCorrection,
} from "../voiceCorrections.js";

/**
 * Section 6 — personal dictionary / correction engine edge cases.
 * Real sqlite (in-memory), real implementation: no mocks, so a pass here is
 * evidence about shipped behaviour rather than about a test double.
 */
describe("Section 6 — correction engine edge cases", () => {
  beforeEach(() => {
    openRippleDbInMemoryForTests();
  });

  // 6.2 — two rules where one spoken form contains the other.
  it("6.2 — overlapping rules resolve longest-match-first, deterministically", () => {
    learnCorrection({ spokenForm: "ana", canonicalForm: "Anna" });
    learnCorrection({ spokenForm: "ana maria", canonicalForm: "Ana-María" });

    // The longer rule must win where both could apply...
    expect(applyCorrectionsToUtterance("tell ana maria hello")).toBe(
      "tell Ana-María hello",
    );
    // ...and the shorter rule must still apply on its own.
    expect(applyCorrectionsToUtterance("tell ana hello")).toBe(
      "tell Anna hello",
    );

    // Determinism: identical input, identical output across repeated runs.
    const runs = new Set(
      Array.from({ length: 5 }, () =>
        applyCorrectionsToUtterance("ana and ana maria"),
      ),
    );
    expect(runs.size).toBe(1);
  });

  // 6.5 — a phonetically similar but genuinely DIFFERENT word must survive.
  it("6.5 — near-miss words are not swallowed by a correction rule", () => {
    learnCorrection({ spokenForm: "mehreen", canonicalForm: "Mehrin" });

    expect(applyCorrectionsToUtterance("ping mehreen now")).toBe(
      "ping Mehrin now",
    );
    // Different words that merely sound close must be left alone.
    for (const word of ["marine", "meringue", "mehreena"]) {
      expect(applyCorrectionsToUtterance(`the ${word} thing`)).toBe(
        `the ${word} thing`,
      );
    }
  });

  // 6.6 — non-ASCII canonical AND non-ASCII spoken forms.
  it("6.6 — unicode dictionary entries apply correctly", () => {
    learnCorrection({ spokenForm: "zoe", canonicalForm: "Zoë" });
    learnCorrection({ spokenForm: "nunez", canonicalForm: "Núñez" });

    expect(applyCorrectionsToUtterance("call zoe nunez")).toBe("call Zoë Núñez");
    // Idempotent: re-running over already-corrected text must not corrupt it.
    expect(applyCorrectionsToUtterance("call Zoë Núñez")).toBe("call Zoë Núñez");
  });

  it("6.6 — a spoken form that is itself non-ASCII still matches", () => {
    learnCorrection({ spokenForm: "josé", canonicalForm: "Jose Ramirez" });
    expect(applyCorrectionsToUtterance("tell josé to wait")).toBe(
      "tell Jose Ramirez to wait",
    );
  });

  // 6.9 — dictionary entry that collides with a real contact name.
  it("6.9 — dictionary entry wins over the raw spoken token, without partial hits", () => {
    learnCorrection({ spokenForm: "sam", canonicalForm: "Samantha" });

    expect(applyCorrectionsToUtterance("ask sam about it")).toBe(
      "ask Samantha about it",
    );
    // Must NOT corrupt words that merely contain the rule as a substring.
    expect(applyCorrectionsToUtterance("the same samsung sample")).toBe(
      "the same samsung sample",
    );
  });

  // 6.3 — a realistically large dictionary must stay correct and fast.
  it("6.3 — 120 dictionary entries stay correct and complete under 250ms", () => {
    for (let i = 0; i < 120; i += 1) {
      learnCorrection({
        spokenForm: `spoken form number ${i}`,
        canonicalForm: `Canonical${i}`,
      });
    }
    const started = Date.now();
    const out = applyCorrectionsToUtterance(
      "start spoken form number 7 middle spoken form number 119 end",
    );
    const elapsed = Date.now() - started;

    expect(out).toBe("start Canonical7 middle Canonical119 end");
    expect(elapsed).toBeLessThan(250);
  });

  it("6.x — case-insensitive matching preserves the canonical casing", () => {
    learnCorrection({ spokenForm: "anzal", canonicalForm: "Anzal" });
    expect(applyCorrectionsToUtterance("ANZAL and Anzal and anzal")).toBe(
      "Anzal and Anzal and Anzal",
    );
  });

  it("6.x — an empty dictionary leaves the utterance byte-identical", () => {
    const text = "nothing here should change at all";
    expect(applyCorrectionsToUtterance(text)).toBe(text);
  });
});
