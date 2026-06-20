/**
 * P6 CI gate — fail if production matrix pass rate < 88%.
 * Run: npm run test:ci:gate
 */
import { describe, expect, it } from "vitest";
import {
  MATRIX_STATS,
  PRODUCTION_E2E_MATRIX,
} from "../../automation/voice/nlu/__tests__/e2e-matrix.data.js";
import { runProductionPipeline } from "../../automation/voice/nlu/__tests__/e2e-pipeline.harness.js";
import { resolveMultilingualCommand } from "../../automation/voice/nlu/__tests__/multilingualPlanner.harness.js";
import { useFreshNluCache } from "../../automation/voice/nlu/__tests__/testHelpers.js";

useFreshNluCache();

const CI_GATE_THRESHOLD = 0.88;

function matrixCasePasses(spec: (typeof PRODUCTION_E2E_MATRIX)[number]): boolean {
  try {
    if (spec.route === "desktop") {
      const resolved = resolveMultilingualCommand(spec.phrase, spec.kind);
      if (resolved.route !== "desktop") return false;
      if (spec.kind && resolved.kind !== spec.kind) return false;
      return true;
    }

    const result = runProductionPipeline(spec.phrase);
    if (result.route !== spec.route) return false;
    if (spec.kind && result.kind !== spec.kind) return false;
    if (spec.route === "whatsapp" && !result.whatsappWorkflow) return false;
    if (spec.route === "youtube" && !result.youtubeWorkflow) return false;
    return true;
  } catch {
    return false;
  }
}

describe("P6 CI gate", () => {
  it(`matrix has ${MATRIX_STATS.total}+ cases`, () => {
    expect(MATRIX_STATS.total).toBeGreaterThanOrEqual(300);
  });

  it(`production matrix pass rate >= ${CI_GATE_THRESHOLD * 100}%`, () => {
    let passed = 0;
    const failures: string[] = [];

    for (const spec of PRODUCTION_E2E_MATRIX) {
      if (matrixCasePasses(spec)) {
        passed++;
      } else {
        failures.push(`${spec.id}: "${spec.phrase}" → expected ${spec.route}/${spec.kind ?? "*"}`);
      }
    }

    const rate = passed / PRODUCTION_E2E_MATRIX.length;
    console.info(
      `[ci-gate] ${passed}/${PRODUCTION_E2E_MATRIX.length} passed (${(rate * 100).toFixed(1)}%)`,
    );
    if (failures.length > 0 && rate < CI_GATE_THRESHOLD) {
      console.info(`[ci-gate] first failures:\n${failures.slice(0, 15).join("\n")}`);
    }

    expect(rate).toBeGreaterThanOrEqual(CI_GATE_THRESHOLD);
  });
});
