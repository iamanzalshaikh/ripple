import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearClarificationContext,
  runPlannerPipeline,
} from "../planner/index.js";
import { runAtomicPlanner } from "../planner/l0Planner.js";
import { ensureP85ToolsRegistered } from "../planner/toolExecutorBridge.js";
import { classifyClause, classifyClauses } from "../planner/v2/clauseClassifier.js";
import { routeRecordToSteps } from "../planner/v2/toolRoutingMatrix.js";
import { planAtomicWithV2, planCompoundWithV2 } from "../planner/v2/plannerV2.js";
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

describe("P8.5 Planner v2", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
    ensureP85ToolsRegistered();
    clearClarificationContext();
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
    clearClarificationContext();
  });

  it("V2-01 classifies open youtube as WORKSPACE_OPEN", () => {
    const r = classifyClause("open youtube", 0, { priorRecords: [] });
    expect(r.clauseType).toBe("WORKSPACE_OPEN");
    expect(routeRecordToSteps(r)?.[0]?.tool).toBe("browser.open_workspace");
  });

  it("V2-02 classifies open chrome as APP_LAUNCH", () => {
    const r = classifyClause("open chrome", 0, { priorRecords: [] });
    expect(r.clauseType).toBe("APP_LAUNCH");
    expect(routeRecordToSteps(r)?.[0]?.tool).toBe("desktop.launch_app");
  });

  it("V2-03 switch chrome and open youtube full plan", () => {
    const result = planCompoundWithV2(
      "Switch to Chrome and open YouTube",
      "switch to chrome and open youtube",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps.map((s) => s.tool)).toEqual([
      "desktop.focus_window",
      "browser.open_workspace",
    ]);
  });

  it("V2-04 switch chrome and search cats", () => {
    const result = planCompoundWithV2(
      "Switch to Chrome and search cats",
      "switch to chrome and search cats",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps.map((s) => s.tool)).toEqual([
      "desktop.focus_window",
      "browser.search_workspace",
    ]);
  });

  it("V2-05 open youtube and search cats uses youtube search engine", () => {
    const records = classifyClauses(["open youtube", "search cats"]);
    expect(records[1]?.clauseType).toBe("MEDIA_SEARCH");
    expect(records[1]?.entities.searchEngine).toBe("youtube");

    const result = planCompoundWithV2(
      "Open YouTube and search cats",
      "open youtube and search cats",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[1]?.args.searchEngine).toBe("youtube");
  });

  it("V2-06 open youtube and search Arthur Ghazi Season 1", () => {
    const records = classifyClauses([
      "open youtube",
      "search Arthur Ghazi Season 1",
    ]);
    expect(records[1]?.clauseType).toBe("MEDIA_SEARCH");

    const result = planCompoundWithV2(
      "Open YouTube and search Arthur Ghazi Season 1",
      "open youtube and search arthur ghazi season 1",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps).toHaveLength(2);
    expect(result.plan.steps[1]?.args.url).toMatch(/youtube\.com\/results/i);
  });

  it("V2-07 open paint and draw a circle", () => {
    const result = planCompoundWithV2(
      "Open paint and draw a circle",
      "open paint and draw a circle",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps.map((s) => s.tool)).toContain("desktop.launch_app");
    expect(result.plan.steps.map((s) => s.tool)).toContain("desktop.mouse_drag");
  });

  it("V2-08 search my resume routes to memory.search", () => {
    const atomic = planAtomicWithV2("Search my resume", "search my resume");
    expect(atomic?.kind).toBe("plan");
    if (atomic?.kind !== "plan") return;
    expect(atomic.plan.steps[0]?.tool).toBe("memory.search");
    expect(atomic.plan.steps[0]?.args.query).toBe("my resume");

    const result = runPlannerPipeline({
      command: "Search my resume",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.tool).toBe("memory.search");
  });

  it("V2-09 open paint and search cats full compound", () => {
    const result = planCompoundWithV2(
      "Open paint and search cats",
      "open paint and search cats",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("desktop.launch_app");
    expect(result.plan.steps[1]?.tool).toBe("browser.search_workspace");
  });

  it("v2 atomic never emits _desktopPayload for workspace opens", () => {
    const result = runAtomicPlanner("Open YouTube", "open youtube", stubWorld());
    expect(result.kind).toBe("plan");
    if (result.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
    expect(result.plan.steps[0]?.args._desktopPayload).toBeUndefined();
  });

  it("pipeline uses v2 for open youtube atomic", () => {
    const result = runPlannerPipeline({
      command: "Open YouTube",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
  });

  describe("E7 compound — filler words before clipboard (notepad)", () => {
    function expectNotepadCopyCompound(cmd: string) {
      const norm = cmd.toLowerCase();
      const result = planCompoundWithV2(cmd, norm);
      expect(result?.kind).toBe("plan");
      if (result?.kind !== "plan") return;
      expect(result.plan.steps.map((s) => s.tool)).toEqual([
        "desktop.launch_app",
        "desktop.type_text",
        "desktop.press_keys",
      ]);
      expect(result.plan.steps[1]?.args.text).toMatch(/hello world/i);
      expect(result.plan.steps[2]?.args.sequence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "^a" }),
          expect.objectContaining({ value: "^c" }),
        ]),
      );
    }

    it("E7-C01 then boundary (working baseline)", () => {
      expectNotepadCopyCompound(
        "Open notepad and write hello world then select all and copy",
      );
    });

    it("E7-C02 comma + then boundary", () => {
      expectNotepadCopyCompound(
        "Open notepad, write hello world, then select all and copy",
      );
    });

    it("E7-C03 strips and second filler before select all", () => {
      expectNotepadCopyCompound(
        "Open notepad, write hello world and second, select all and copy",
      );
    });

    it("E7-C04 and then copy it after type_text → select all copy", () => {
      const result = planCompoundWithV2(
        "Open notepad, write hello world and then copy it",
        "open notepad, write hello world and then copy it",
      );
      expect(result?.kind).toBe("plan");
      if (result?.kind !== "plan") return;
      expect(result.plan.steps.map((s) => s.tool)).toEqual([
        "desktop.launch_app",
        "desktop.type_text",
        "desktop.press_keys",
      ]);
      expect(result.plan.steps[2]?.args.sequence?.[1]?.value).toBe("^c");
    });

    it("E7-C05 after that select all", () => {
      expectNotepadCopyCompound(
        "Open notepad, type hello world after that select all and copy",
      );
    });

    it("E7-C06 finally copy everything", () => {
      const result = planCompoundWithV2(
        "Open notepad, write hello world and finally copy everything",
        "open notepad, write hello world and finally copy everything",
      );
      expect(result?.kind).toBe("plan");
      if (result?.kind !== "plan") return;
      expect(result.plan.steps.map((s) => s.tool)).toEqual([
        "desktop.launch_app",
        "desktop.type_text",
        "desktop.press_keys",
      ]);
    });
  });
});
