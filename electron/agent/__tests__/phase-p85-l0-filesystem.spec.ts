import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  tryL0FilesystemPlan,
  parseFilesystemSearchCommand,
  parseFilesystemReadCommand,
  isFilesystemPlannerUtterance,
} from "../planner/l0FilesystemPlanner.js";
import { runPlannerPipeline, tryCompoundGate } from "../planner/index.js";
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

describe("P8.5 L0 filesystem planner", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("parses find horizon backend as search", () => {
    expect(parseFilesystemSearchCommand("find horizon backend")?.query).toBe(
      "horizon backend",
    );
  });

  it("does not treat find potential bug in current code as filesystem search", () => {
    expect(
      parseFilesystemSearchCommand("Find potential bug in my current code"),
    ).toBeNull();
    expect(tryL0FilesystemPlan(
      "Find potential bug in my current code",
      "find potential bug in my current code",
    )).toBeNull();

    const pipeline = runPlannerPipeline({
      command: "Find potential bug in my current code",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    const tools = pipeline.plan.steps.map((s) => s.tool);
    expect(tools).not.toContain("filesystem.search");
    expect(
      tools.some(
        (t) =>
          t === "automation.analyze_codebase" ||
          t === "automation.scan_project" ||
          t === "automation.find_code",
      ),
    ).toBe(true);
  });

  it("parses read package.json", () => {
    const intent = parseFilesystemReadCommand("read package.json");
    expect(intent?.kind).toBe("read_file");
    expect(intent?.fileName).toBe("package.json");
  });

  it("plans search via filesystem.search", () => {
    const result = tryL0FilesystemPlan(
      "find horizon backend",
      "find horizon backend",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.search");
    expect(result.plan.steps[0]?.args.query).toBe("horizon backend");
  });

  it("plans read via filesystem.read_file", () => {
    const result = tryL0FilesystemPlan(
      "read package.json",
      "read package.json",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.read_file");
  });

  it("compound gate skips filesystem utterances", () => {
    expect(
      tryCompoundGate("find horizon backend", "find horizon backend"),
    ).toBeNull();
    expect(isFilesystemPlannerUtterance("read package.json")).toBe(true);
  });

  it("pipeline executes plan for find horizon backend", () => {
    const result = runPlannerPipeline({
      command: "find horizon backend",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.search");
  });
});
