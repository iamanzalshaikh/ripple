import { describe, expect, it } from "vitest";
import {
  nluForGptPlanner,
  shouldSkipFastPathForGpt,
  shouldUseGptRawOnly,
  speechForGptPlanner,
} from "../aiFirstRouting.js";
import { preprocessForNlu } from "../preprocess.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("AI-first routing (P4)", () => {
  it.each([
    "create, naya folder banao download ke andar, name vz",
    "Create karo new folder naam until downloaded",
  ])('defers weak/incomplete fast path: "%s"', (phrase) => {
    expect(shouldSkipFastPathForGpt(phrase)).toBe(true);
  });

  it("keeps clean fast path for standard Hinglish slot pattern", () => {
    expect(
      shouldSkipFastPathForGpt("Downloads mein folder banao naam user"),
    ).toBe(false);
    expect(
      shouldUseGptRawOnly("Downloads mein folder banao naam user"),
    ).toBe(false);
  });

  it("fixes glued naamB2 and uses fast path", () => {
    const cmd = "Documents mein folder banao naamB2";
    expect(shouldSkipFastPathForGpt(cmd)).toBe(false);
    expect(shouldUseGptRawOnly(cmd)).toBe(false);
    const { nlu } = preprocessForNlu(cmd);
    expect(nlu.toLowerCase()).toContain("create folder in documents");
    expect(nlu.toLowerCase()).toContain("named b2");
  });

  it("routes Hinglish create folder through desktop guard (not raw mojibake)", () => {
    const raw = "Naya folder create karo, downloads kahande, name v4";
    expect(shouldUseGptRawOnly(raw)).toBe(false);
  });

  it("does not send half-Hinglish NLU to GPT", () => {
    const raw = "Create karo new folder, download ke anda name b2";
    const partial = "Create new folder, downloads ke anda name b2";
    expect(nluForGptPlanner(raw, partial)).toBeUndefined();
  });

  it("does not send garbled NLU to GPT", () => {
    const raw = "create, naya folder banao download ke andar, name vz";
    const garbled = "Create, naya create folder downloads ke andar, name vz";
    expect(nluForGptPlanner(raw, garbled)).toBeUndefined();
  });

  it("passes helpful NLU when preprocess is clean", () => {
    const raw = "Downloads mein folder banao naam user";
    const clean = "Create folder in downloads, named user";
    expect(nluForGptPlanner(raw, clean)).toBe(clean);
  });
});
