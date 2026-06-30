/**
 * P6 CI gate — fail if production matrix pass rate < 88%.
 * Run: npm run test:ci:gate
 */
import { describe, expect, it } from "vitest";
import { getMatrixStats, evaluateCiGate, CI_GATE_THRESHOLD } from "../ciGateStatus.js";
import { useFreshNluCache } from "../../automation/voice/nlu/__tests__/testHelpers.js";

useFreshNluCache();

describe("P6 CI gate", () => {
  it(`matrix has ${getMatrixStats().total}+ cases`, () => {
    expect(getMatrixStats().total).toBeGreaterThanOrEqual(300);
  });

  it(`production matrix pass rate >= ${CI_GATE_THRESHOLD * 100}%`, () => {
    const result = evaluateCiGate();
    console.info(
      `[ci-gate] ${result.passed}/${result.total} passed (${result.passRatePercent}%)`,
    );
    if (!result.meetsGate && result.failures.length > 0) {
      console.info(
        `[ci-gate] first failures:\n${result.failures.slice(0, 15).join("\n")}`,
      );
    }
    expect(result.passRatePercent / 100).toBeGreaterThanOrEqual(CI_GATE_THRESHOLD);
  });
});
