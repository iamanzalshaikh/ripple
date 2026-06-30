import { describe, expect, it } from "vitest";
import { evaluateCiGate, CI_GATE_THRESHOLD } from "../ciGateStatus.js";
import { useFreshNluCache } from "../../automation/voice/nlu/__tests__/testHelpers.js";

useFreshNluCache();

describe("ciGateStatus P6", () => {
  it("meets 88% threshold", () => {
    const result = evaluateCiGate();
    expect(result.total).toBeGreaterThanOrEqual(300);
    expect(result.passRatePercent / 100).toBeGreaterThanOrEqual(CI_GATE_THRESHOLD);
  });
});
