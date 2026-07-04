import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyUtterance,
  ensureP85ToolsRegistered,
  runPlannerPipeline,
} from "../planner/index.js";
import { planAtomicWithV2, planCompoundWithV2 } from "../planner/v2/plannerV2.js";
import { routeRecordToSteps } from "../planner/v2/toolRoutingMatrix.js";
import { classifyClause } from "../planner/v2/clauseClassifier.js";
import type { WorldModel } from "../types.js";

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, windowUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: false, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: true,
      sendInput: true,
      uia: true,
      ocr: true,
    },
    activeGoal: null,
  };
}

describe("P8.5 Planner v2 — forgiving execution", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
    ensureP85ToolsRegistered();
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("treats create folder with comma name as atomic not compound", () => {
    const cmd = "create folder in downloads, named Anzal";
    expect(classifyUtterance(cmd, cmd)).toBe("atomic");
  });

  it("routes FILE_MUTATE create folder to filesystem.create_folder", () => {
    const record = classifyClause(
      "create folder in downloads, named Anzal",
      0,
      { priorRecords: [] },
    );
    expect(record.clauseType).toBe("FILE_MUTATE");
    const steps = routeRecordToSteps(record);
    expect(steps?.[0]?.tool).toBe("filesystem.create_folder");
    expect(steps?.[0]?.args.folderName).toBe("Anzal");
    expect(steps?.[0]?.args.parentFolder).toBe("downloads");
  });

  it("pipeline executes create folder in downloads named Anzal", () => {
    const result = runPlannerPipeline({
      command: "Create folder in downloads, named Anzal",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.create_folder");
    expect(result.plan.steps[0]?.args.folderName).toMatch(/anzal/i);
  });

  it("atomic v2 returns null for unknown instead of clarify", () => {
    const result = planAtomicWithV2("quantum flux capacitor", "quantum flux capacitor");
    expect(result).toBeNull();
  });

  it("move file routes through FILE_MUTATE matrix", () => {
    const record = classifyClause(
      "Move Invoice.pdf from Downloads to Desktop",
      0,
      { priorRecords: [] },
    );
    expect(record.clauseType).toBe("FILE_MUTATE");
    expect(routeRecordToSteps(record)?.[0]?.tool).toBe("filesystem.move");
  });

  it("compound v2 falls through when all clauses unknown", () => {
    const result = planCompoundWithV2(
      "quantum flux and capacitor warp",
      "quantum flux and capacitor warp",
    );
    expect(result).toBeNull();
  });
});
