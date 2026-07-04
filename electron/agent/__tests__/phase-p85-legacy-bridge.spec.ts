import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWorkflowMetaCommand } from "../../automation/desktop/parseWorkflowCommand.js";
import { parseWorkflowStepList } from "../../automation/desktop/userWorkflows.js";
import { extractDirectTypingText } from "../parseDesktopInput.js";
import { routeRecordToSteps } from "../planner/v2/toolRoutingMatrix.js";
import { classifyClause } from "../planner/v2/clauseClassifier.js";
import { runPlannerPipeline } from "../planner/index.js";
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

describe("P8.5 legacy bridge + voice routing fixes", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
  });

  it("remember work mode parses youtube paint calculator steps", () => {
    const intent = parseWorkflowMetaCommand(
      "Remember my work mode open YouTube, Paint and Calculator",
    );
    expect(intent?.kind).toBe("remember_workflow");
    if (intent?.kind !== "remember_workflow") return;
    const steps = parseWorkflowStepList(intent.stepsRaw);
    expect(steps.map((s) => `${s.type}:${s.target}`)).toEqual([
      "workspace:youtube",
      "app:paint",
      "app:calculator",
    ]);
  });

  it("fixes STT modeopen glue for remember workflow", () => {
    const intent = parseWorkflowMetaCommand(
      "Remember work modeopen youtube, paint",
    );
    expect(intent?.kind).toBe("remember_workflow");
    if (intent?.kind !== "remember_workflow") return;
    expect(parseWorkflowStepList(intent.stepsRaw)).toHaveLength(2);
  });

  it("splits glued youtube calculator and drops pinned STT tail", () => {
    const intent = parseWorkflowMetaCommand(
      "Remember work mode open YouTube Calculator, Pinned",
    );
    expect(intent?.kind).toBe("remember_workflow");
    if (intent?.kind !== "remember_workflow") return;
    expect(parseWorkflowStepList(intent.stepsRaw).map((s) => `${s.type}:${s.target}`)).toEqual(
      ["workspace:youtube", "app:calculator"],
    );
  });

  it("does not steal gmail commands as direct typing", () => {
    expect(
      extractDirectTypingText(
        "Write a mail to sheikhanzal95 at gmail.com about interview",
      ),
    ).toBeNull();
  });

  it("routes remember workflow through legacy bridge under v2", () => {
    const result = runPlannerPipeline({
      command: "Remember my work mode open YouTube, Paint and Calculator",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.args._desktopPayload).toBeDefined();
  });

  it("open last pdf defers to legacy desktop path under v2", () => {
    const result = runPlannerPipeline({
      command: "Open last pdf I opened",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.args._desktopPayload).toBeDefined();
  });

  it("save as note.txt in downloads passes folder to save_file tool", () => {
    const record = classifyClause(
      "save as note.txt in downloads",
      0,
      { priorRecords: [] },
    );
    expect(record.clauseType).toBe("SAVE_FILE");
    const steps = routeRecordToSteps(record);
    expect(steps?.[0]?.tool).toBe("desktop.save_file");
    expect(steps?.[0]?.args.folder).toBe("downloads");
  });
});
