import {
  MATRIX_STATS,
  PRODUCTION_E2E_MATRIX,
  type E2ECase,
} from "../automation/voice/nlu/__tests__/e2e-matrix.data.js";
import { runProductionPipeline } from "../automation/voice/nlu/__tests__/e2e-pipeline.harness.js";
import { resolveMultilingualCommand } from "../automation/voice/nlu/__tests__/multilingualPlanner.harness.js";

export const CI_GATE_THRESHOLD = 0.88;

export type CiGateResult = {
  passed: number;
  total: number;
  passRatePercent: number;
  thresholdPercent: number;
  meetsGate: boolean;
  failures: string[];
};

function matrixCasePasses(spec: E2ECase): boolean {
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

/** P6 — evaluate production matrix pass rate (used by CI gate + observability UI). */
export function evaluateCiGate(): CiGateResult {
  let passed = 0;
  const failures: string[] = [];

  for (const spec of PRODUCTION_E2E_MATRIX) {
    if (matrixCasePasses(spec)) {
      passed++;
    } else {
      failures.push(
        `${spec.id}: "${spec.phrase}" → expected ${spec.route}/${spec.kind ?? "*"}`,
      );
    }
  }

  const total = PRODUCTION_E2E_MATRIX.length;
  const passRatePercent = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;

  return {
    passed,
    total,
    passRatePercent,
    thresholdPercent: CI_GATE_THRESHOLD * 100,
    meetsGate: total > 0 && passed / total >= CI_GATE_THRESHOLD,
    failures,
  };
}

export function getMatrixStats(): typeof MATRIX_STATS {
  return MATRIX_STATS;
}
