import { describe, expect, it } from "vitest";
import { policyFor } from "../../voice/nlu/confidencePolicy.js";

describe("confidencePolicy", () => {
  it("executes at high confidence with one candidate", () => {
    expect(policyFor(0.95, 1)).toBe("execute");
    expect(policyFor(0.9, 0)).toBe("execute");
  });

  it("clarifies in mid confidence band", () => {
    expect(policyFor(0.75, 3)).toBe("clarify");
    expect(policyFor(0.6, 0)).toBe("clarify");
  });

  it("rephrases below 0.6", () => {
    expect(policyFor(0.59, 1)).toBe("rephrase");
    expect(policyFor(0.2, 0)).toBe("rephrase");
  });
});
