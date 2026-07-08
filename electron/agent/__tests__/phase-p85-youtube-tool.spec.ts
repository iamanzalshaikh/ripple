import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0YouTubePlan } from "../planner/l0YouTubePlanner.js";
import {
  buildExecutorPayload,
  runPlannerPipeline,
  shouldBypassP85Planner,
  tryCompoundGate,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/adapters/youtube/runYouTubeAction.js", () => ({
  runYouTubeBatch: vi.fn(async () => "YouTube search done"),
}));

let youtubeFocused = false;
vi.mock("../../focus/focusContext.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../focus/focusContext.js")>();
  return {
    ...actual,
    isYouTubeFocused: () => youtubeFocused,
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

describe("P8.5 YouTube tool planner", () => {
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
    youtubeFocused = false;
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("does not bypass P85 for youtube commands", () => {
    expect(shouldBypassP85Planner("Search cats on YouTube")).toBe(false);
    expect(shouldBypassP85Planner("Open YouTube")).toBe(false);
  });

  it("plans open youtube via browser.open_workspace", () => {
    const result = tryL0YouTubePlan("Open YouTube", "open youtube");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
    expect(result.plan.steps[0]?.args.workspaceId).toBe("youtube");
  });

  it("plans search on youtube via browser.youtube.run", () => {
    const result = tryL0YouTubePlan(
      "Search React tutorial on YouTube",
      "search react tutorial on youtube",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.youtube.run");
    expect(result.plan.steps[0]?.args.kind).toBe("search");
    expect(result.plan.steps[0]?.args.query).toMatch(/react tutorial/i);
  });

  it("plans play on youtube via browser.youtube.run", () => {
    const result = tryL0YouTubePlan(
      "Play Arthur Ghazi Season 1 on YouTube",
      "play arthur ghazi season 1 on youtube",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.youtube.run");
    expect(result.plan.steps[0]?.args.kind).toBe("play");
  });

  it("plans open youtube and search cats atomically", () => {
    const result = tryL0YouTubePlan(
      "Open YouTube and search cats",
      "open youtube and search cats",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.youtube.run");
    expect(result.plan.steps[0]?.args.query).toBe("cats");
  });

  it("contextual search while youtube focused", () => {
    youtubeFocused = true;
    const result = tryL0YouTubePlan("Search cats", "search cats");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.youtube.run");
    expect(result.plan.steps[0]?.args.query).toBe("cats");
  });

  it("compound gate skips youtube utterances", () => {
    const gate = tryCompoundGate(
      "Open YouTube and search cats",
      "open youtube and search cats",
    );
    expect(gate).toBeNull();
  });

  it("pipeline executes youtube search via L0 tools", () => {
    const pipeline = runPlannerPipeline({
      command: "Search cats on YouTube",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(pipeline.plan.steps[0]?.tool).toBe("browser.youtube.run");
  });

  it("executor payload bridges browser.youtube.run", () => {
    const plan = tryL0YouTubePlan(
      "Search cats on YouTube",
      "search cats on youtube",
    );
    if (plan?.kind !== "plan") throw new Error("expected plan");
    const bridged = buildExecutorPayload(plan.plan, "Search cats on YouTube", stubWorld());
    expect(bridged.kind).not.toBe("invalid");
  });
});
