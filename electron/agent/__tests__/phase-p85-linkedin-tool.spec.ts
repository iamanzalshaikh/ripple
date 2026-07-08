import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0LinkedInPlan } from "../planner/l0LinkedInPlanner.js";
import {
  buildExecutorPayload,
  runPlannerPipeline,
  shouldBypassP85Planner,
  tryCompoundGate,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/adapters/linkedin/runLinkedInAction.js", () => ({
  runLinkedInBatch: vi.fn(async () => "LinkedIn done"),
}));

vi.mock("../../focus/focusContext.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../focus/focusContext.js")>();
  return {
    ...actual,
    isLinkedInTabActive: () => false,
    isWhatsAppTabActive: () => false,
  };
});

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

describe("P8.5 LinkedIn tool planner", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
    clearRegisteredToolsForTests();
    resetPhase1BrowserToolsForTests();
    registerPhase1BrowserTools();
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("does not bypass P85 for linkedin commands", () => {
    expect(shouldBypassP85Planner("Open LinkedIn")).toBe(false);
    expect(
      shouldBypassP85Planner("Search people named Jasmine on LinkedIn"),
    ).toBe(false);
  });

  it("plans open linkedin via browser.open_workspace", () => {
    const result = tryL0LinkedInPlan("Open LinkedIn", "open linkedin");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
    expect(result.plan.steps[0]?.args.workspaceId).toBe("linkedin");
  });

  it("plans people search via browser.linkedin.run", () => {
    const result = tryL0LinkedInPlan(
      "Search people named Jasmine Pathan on LinkedIn",
      "search people named jasmine pathan on linkedin",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.linkedin.run");
    expect(result.plan.steps[0]?.args.kind).toBe("search_people");
    expect(result.plan.steps[0]?.args.query).toMatch(/jasmine/i);
  });

  it("compound gate skips linkedin utterances", () => {
    const gate = tryCompoundGate(
      "Open LinkedIn and search people named Jasmine",
      "open linkedin and search people named jasmine",
    );
    expect(gate).toBeNull();
  });

  it("pipeline executes linkedin search via L0 tools", () => {
    const pipeline = runPlannerPipeline({
      command: "Search people named Jasmine on LinkedIn",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(pipeline.plan.steps[0]?.tool).toBe("browser.linkedin.run");
  });

  it("executor payload bridges browser.linkedin.run", () => {
    const plan = tryL0LinkedInPlan(
      "Open LinkedIn",
      "open linkedin",
    );
    if (plan?.kind !== "plan") throw new Error("expected plan");
    const bridged = buildExecutorPayload(plan.plan, "Open LinkedIn", stubWorld());
    expect(bridged.kind).not.toBe("invalid");
  });
});
