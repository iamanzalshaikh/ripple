import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0InstagramPlan } from "../planner/l0InstagramPlanner.js";
import {
  runPlannerPipeline,
  shouldBypassP85Planner,
  tryCompoundGate,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/adapters/instagram/runInstagramAction.js", () => ({
  runInstagramBatch: vi.fn(async () => "Instagram done"),
}));

vi.mock("../../focus/focusContext.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../focus/focusContext.js")>();
  return {
    ...actual,
    isInstagramTabActive: () => false,
    isInstagramFocused: () => false,
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

describe("P8.5 Instagram tool planner", () => {
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

  it("does not bypass P85 for instagram message commands", () => {
    expect(shouldBypassP85Planner("Message Anzal saying hi on Instagram")).toBe(
      false,
    );
  });

  it("plans open instagram via browser.open_workspace", () => {
    const result = tryL0InstagramPlan("Open Instagram", "open instagram");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
    expect(result.plan.steps[0]?.args.workspaceId).toBe("instagram");
  });

  it("plans message via browser.instagram.run", () => {
    const result = tryL0InstagramPlan(
      "Message Anzal saying hello on Instagram",
      "message anzal saying hello on instagram",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.instagram.run");
    expect(result.plan.steps[0]?.args.kind).toBe("message");
    expect(result.plan.steps[0]?.args.username).toBe("Anzal");
    expect(result.plan.steps[0]?.args.text).toMatch(/hello/i);
  });

  it("compound gate skips instagram utterances", () => {
    expect(
      tryCompoundGate(
        "Message Anzal saying hello on Instagram",
        "message anzal saying hello on instagram",
      ),
    ).toBeNull();
  });

  it("pipeline produces execute plan for instagram message", () => {
    const result = runPlannerPipeline({
      command: "Message Anzal saying hello on Instagram",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.instagram.run");
  });
});
