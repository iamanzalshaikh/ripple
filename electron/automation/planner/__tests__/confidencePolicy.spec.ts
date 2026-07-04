import { describe, expect, it } from "vitest";
import { policyFor } from "../../voice/nlu/confidencePolicy.js";

describe("confidencePolicy", () => {
  it("executes at high confidence with one candidate", () => {
    expect(policyFor(0.95, 1)).toBe("execute");
    expect(policyFor(0.9, 0)).toBe("execute");
  });

  it("clarifies only below 0.2", () => {
    expect(policyFor(0.75, 3)).toBe("execute");
    expect(policyFor(0.6, 0)).toBe("execute");
    expect(policyFor(0.4, 0)).toBe("execute");
  });

  it("rephrases in low-mid band (fallback route)", () => {
    expect(policyFor(0.39, 1)).toBe("rephrase");
    expect(policyFor(0.2, 0)).toBe("rephrase");
  });

  it("clarifies only when very uncertain", () => {
    expect(policyFor(0.19, 1)).toBe("clarify");
    expect(policyFor(0.1, 0)).toBe("clarify");
  });
});
