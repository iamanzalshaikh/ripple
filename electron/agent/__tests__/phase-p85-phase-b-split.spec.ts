import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCompoundPartialResult,
  clearClarificationContext,
  runPlannerPipeline,
  tryL0PartialCompoundPlan,
  tryPlanUnresolvedClause,
  validatePartialPlan,
} from "../planner/index.js";
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

describe("P8.5 Phase B Stage 1 — compound split", () => {
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PHASE_B = "1";
    process.env.RIPPLE_P85_PLANNER_V2 = "0";
    clearClarificationContext();
  });

  afterEach(() => {
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
    clearClarificationContext();
  });

  it("splits open paint + draw a circle into resolved + unresolved", () => {
    const partial = tryL0PartialCompoundPlan(
      "Open paint and draw a circle",
      "open paint and draw a circle",
    );
    expect(partial).not.toBeNull();
    expect(partial!.unresolvedClauses).toEqual(["draw a circle"]);
    expect(partial!.plan.steps.map((s) => s.tool)).toContain("desktop.launch_app");
    expect(partial!.splitPreview).toHaveLength(2);
    expect(partial!.splitPreview[0]?.status).toBe("resolved");
    expect(partial!.splitPreview[0]?.summary).toMatch(/open paint/i);
    expect(partial!.splitPreview[1]?.status).toBe("unresolved");
    expect(partial!.splitPreview[1]?.action).toBe("draw");
    expect(partial!.splitPreview[1]?.summary).toBe("draw circle");
  });

  it("validatePartialPlan requires both resolved steps and unresolved clauses", () => {
    const partial = tryL0PartialCompoundPlan(
      "Open paint and draw a circle",
      "open paint and draw a circle",
    )!;
    expect(validatePartialPlan(partial.plan, partial.unresolvedClauses).valid).toBe(
      true,
    );
    expect(validatePartialPlan(partial.plan, []).valid).toBe(false);
  });

  it("plans draw circle tail steps", () => {
    const steps = tryPlanUnresolvedClause("draw a circle");
    expect(steps?.map((s) => s.tool)).toEqual([
      "desktop.mouse_move",
      "desktop.mouse_drag",
    ]);
    expect(steps?.[1]?.args.shape).toBe("ellipse");
  });

  it("pipeline returns partial when Phase B is on", () => {
    const result = runPlannerPipeline({
      command: "Open paint and draw a circle",
      world: stubWorld(),
    });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.reason).toBe("compound_partial");
    expect(result.plan.steps.map((s) => s.tool)).toContain("desktop.launch_app");
    expect(result.unresolvedClauses).toContain("draw a circle");
    expect(result.splitPreview.some((s) => s.status === "unresolved")).toBe(true);
  });

  it("full compound still executes when all clauses resolve", () => {
    const result = runPlannerPipeline({
      command: "open notepad and type hello",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps.map((s) => s.tool)).toEqual([
      "desktop.launch_app",
      "desktop.type_text",
    ]);
  });

  it("without Phase B flag, unresolved compound clarifies instead of partial", () => {
    process.env.RIPPLE_P85_PHASE_B = "0";
    const result = runPlannerPipeline({
      command: "Open paint and draw a circle",
      world: stubWorld(),
    });
    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") {
      expect(result.reason).toBe("compound_unresolved");
    }
  });

  it("buildCompoundPartialResult wraps split for orchestrator", () => {
    const partial = tryL0PartialCompoundPlan(
      "Open Paint, draw a circle",
      "open paint, draw a circle",
    )!;
    const built = buildCompoundPartialResult(
      "Open Paint, draw a circle",
      "open paint, draw a circle",
      partial,
    );
    expect(built.kind).toBe("partial");
    expect(built.question).toContain("draw a circle");
  });

  it("resolves switch to chrome + open youtube as full compound plan", () => {
    const result = runPlannerPipeline({
      command: "Switch to Chrome and open YouTube",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps.map((s) => s.tool)).toEqual([
      "desktop.focus_window",
      "browser.open_workspace",
    ]);
    expect(result.plan.steps[1]?.args.workspaceId).toBe("youtube");
    expect(result.plan.steps[1]?.args.url).toMatch(/youtube\.com/i);
  });

  it("plans open youtube tail after switch chrome partial split", () => {
    const steps = tryPlanUnresolvedClause("open YouTube");
    expect(steps?.map((s) => s.tool)).toEqual(["browser.open_workspace"]);
    expect(steps?.[0]?.args.workspaceId).toBe("youtube");
  });

  it("atomic open youtube uses browser.open_workspace not desktop.launch_app", () => {
    const result = runPlannerPipeline({
      command: "Open YouTube",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps).toHaveLength(1);
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
  });

  it("switch chrome and search cats uses focus + browser search", () => {
    const result = runPlannerPipeline({
      command: "Switch to Chrome and search cats",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps.map((s) => s.tool)).toEqual([
      "desktop.focus_window",
      "browser.search_workspace",
    ]);
  });
});
