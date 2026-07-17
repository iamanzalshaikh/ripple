import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0NotionPlan } from "../planner/l0NotionPlanner.js";
import {
  runPlannerPipeline,
  shouldBypassP85Planner,
  tryCompoundGate,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/adapters/notion/runNotionAction.js", () => ({
  runNotionBatch: vi.fn(async () => "Notion done"),
}));

vi.mock("../../focus/focusContext.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../focus/focusContext.js")>();
  return {
    ...actual,
    isNotionFocused: () => false,
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

describe("P8.5 Notion tool planner", () => {
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

  it("does not bypass P85 for notion create-page commands", () => {
    expect(
      shouldBypassP85Planner(
        "Create a new Notion page and paste my clipboard",
      ),
    ).toBe(false);
  });

  it("plans open notion via browser.open_workspace", () => {
    const result = tryL0NotionPlan("Open Notion", "open notion");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
    expect(result.plan.steps[0]?.args.workspaceId).toBe("notion");
  });

  it("plans create page via browser.notion.run with pasteClipboard", () => {
    const result = tryL0NotionPlan(
      "Create a new Notion page and paste my clipboard",
      "create a new notion page and paste my clipboard",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.notion.run");
    expect(result.plan.steps[0]?.args.kind).toBe("create_page");
    expect(result.plan.steps[0]?.args.pasteClipboard).toBe(true);
  });

  it("compound gate skips notion utterances", () => {
    expect(
      tryCompoundGate(
        "Create a new Notion page and paste my clipboard",
        "create a new notion page and paste my clipboard",
      ),
    ).toBeNull();
  });

  it("pipeline produces execute plan for open notion", () => {
    const result = runPlannerPipeline({
      command: "Open Notion",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
  });
});
