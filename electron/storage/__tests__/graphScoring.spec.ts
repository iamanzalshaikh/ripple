import { describe, expect, it } from "vitest";
import { compositeScore, recencyScore } from "../graphScoring.js";

describe("graphScoring", () => {
  it("ranks recent opens higher", () => {
    const recent = recencyScore(Date.now() - 1000);
    const old = recencyScore(Date.now() - 200 * 24 * 60 * 60 * 1000);
    expect(recent).toBeGreaterThan(old);
  });

  it("combines frequency and recency", () => {
    const high = compositeScore({
      openCount: 10,
      lastOpenedAtMs: Date.now(),
    });
    const low = compositeScore({
      openCount: 1,
      lastOpenedAtMs: Date.now() - 365 * 24 * 60 * 60 * 1000,
    });
    expect(high).toBeGreaterThan(low);
  });
});
