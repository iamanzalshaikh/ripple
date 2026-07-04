import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  resetPhase1DesktopToolsForTests,
  registerPhase1DesktopTools,
} from "../planner/tools/desktopTools.js";
import {
  isToolExecutorRouteEnabled,
  planEligibleForToolExecutor,
} from "../planner/toolExecutorBridge.js";
import { buildExecutorPayload } from "../planner/plannerExecutor.js";
import { runValidatedPlanExecution } from "../planner/executionRequest.js";
import {
  legacyDesktopRoutersEnabled,
  legacyKillSwitchActive,
  legacyPlanDesktopEnabled,
  p85DesktopEntryEnabled,
} from "../planner/legacyRouterGate.js";
import type { ExecutionPlan } from "../planner/planTypes.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/actions/insertText.js", () => ({
  runInsertText: vi.fn(async (data?: Record<string, unknown>) => {
    const text = typeof data?.text === "string" ? data.text : "";
    if (text) return `Typed ${text}`;
    return "desktop_input_ok";
  }),
}));

const stubWorld = (): WorldModel => ({
  capturedAt: 0,
  foreground: null,
  focusedField: null,
  focusContext: null,
  mouse: { x: 0, y: 0, windowUnderCursor: null },
  browser: { surface: null },
  clipboard: { hasText: false, preview: "", length: 0 },
  capabilities: {
    sidecarConnected: false,
    sendInput: true,
    uia: false,
    ocr: false,
  },
  activeGoal: null,
});

const typePlan = (): ExecutionPlan => ({
  goal: "type",
  confidence: 1,
  steps: [{ tool: "desktop.type_text", args: { text: "hello" } }],
  rawUtterance: "type hello",
  normalizedUtterance: "type hello",
  source: "L0",
});

describe("P8.5 Phase 4 — router deprecation", () => {
  const prevExecutor = process.env.RIPPLE_P85_TOOL_EXECUTOR;
  const prevKill = process.env.RIPPLE_P85_KILL;

  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase1DesktopToolsForTests();
    registerPhase1DesktopTools();
    delete process.env.RIPPLE_P85_TOOL_EXECUTOR;
    delete process.env.RIPPLE_P85_KILL;
    delete process.env.RIPPLE_P85_LEGACY_DESKTOP_FAST;
  });

  afterEach(() => {
    if (prevExecutor === undefined) {
      delete process.env.RIPPLE_P85_TOOL_EXECUTOR;
    } else {
      process.env.RIPPLE_P85_TOOL_EXECUTOR = prevExecutor;
    }
    if (prevKill === undefined) {
      delete process.env.RIPPLE_P85_KILL;
    } else {
      process.env.RIPPLE_P85_KILL = prevKill;
    }
  });

  it("legacy desktop routers off by default", () => {
    expect(legacyDesktopRoutersEnabled()).toBe(false);
    expect(legacyPlanDesktopEnabled()).toBe(false);
    expect(p85DesktopEntryEnabled()).toBe(true);
  });

  it("kill switch enables legacy routers and disables P8.5 entry", () => {
    process.env.RIPPLE_P85_KILL = "1";
    expect(legacyKillSwitchActive()).toBe(true);
    expect(legacyDesktopRoutersEnabled()).toBe(true);
    expect(legacyPlanDesktopEnabled()).toBe(true);
    expect(p85DesktopEntryEnabled()).toBe(false);
  });

  it("tool executor route is on by default", () => {
    expect(isToolExecutorRouteEnabled()).toBe(true);
  });

  it("tool executor can be disabled with RIPPLE_P85_TOOL_EXECUTOR=0", () => {
    process.env.RIPPLE_P85_TOOL_EXECUTOR = "0";
    expect(isToolExecutorRouteEnabled()).toBe(false);
  });

  it("buildExecutorPayload returns executor kind by default", () => {
    const plan = typePlan();
    expect(planEligibleForToolExecutor(plan)).toBe(true);
    const built = buildExecutorPayload(plan, "type hello", stubWorld());
    expect(built.kind).toBe("executor");
  });

  it("runValidatedPlanExecution uses executor route by default", async () => {
    const plan = typePlan();
    const built = buildExecutorPayload(plan, "type hello", stubWorld());
    if (built.kind !== "executor" && built.kind !== "payload") {
      throw new Error("unexpected build kind");
    }

    const runPayload = vi.fn();
    const result = await runValidatedPlanExecution({
      plan,
      command: "type hello",
      world: stubWorld(),
      built,
      runPayload,
    });

    expect(result.via).toBe("executor");
    expect(result.ok).toBe(true);
    expect(runPayload).not.toHaveBeenCalled();
  });

  it("runValidatedPlanExecution falls back to payload when executor disabled", async () => {
    process.env.RIPPLE_P85_TOOL_EXECUTOR = "0";
    const plan = typePlan();
    const built = buildExecutorPayload(plan, "type hello", stubWorld());
    if (built.kind !== "executor" && built.kind !== "payload") {
      throw new Error("unexpected build kind");
    }

    const runPayload = vi.fn(async () => ({
      command_id: built.payload.command_id,
      allSucceeded: true,
      records: [
        {
          index: 0,
          type: "INSERT_TEXT" as const,
          status: "executed" as const,
        },
      ],
    }));

    const result = await runValidatedPlanExecution({
      plan,
      command: "type hello",
      world: stubWorld(),
      built,
      runPayload,
    });

    expect(result.via).toBe("payload");
    expect(result.ok).toBe(true);
    expect(runPayload).toHaveBeenCalledOnce();
  });
});
