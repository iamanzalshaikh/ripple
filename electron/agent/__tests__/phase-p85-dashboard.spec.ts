import { describe, expect, it, beforeEach } from "vitest";
import {
  buildPlannerDashboardSummary,
  formatPlannerDashboardLine,
  recordRouterMismatch,
  recordP85Execute,
  resetRouterParity,
  storeCachedPlan,
  clearPlanCache,
  exportPlannerShadowCsv,
  observeP85Execution,
  getRecentExecutionObservations,
  resetExecutionObservations,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

function emptyWorld(): WorldModel {
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

describe("P8.5 metrics dashboard", () => {
  beforeEach(() => {
    resetRouterParity();
    clearPlanCache();
  });

  it("builds dashboard summary with router parity", () => {
    recordP85Execute();
    recordP85Execute();
    recordRouterMismatch("desktop-fast", "no_l0_match", "open chrome");

    const dash = buildPlannerDashboardSummary(50);
    expect(dash.routerParity.p85Executes).toBe(2);
    expect(dash.routerParity.mismatchTotal).toBe(1);
    expect(dash.session).toBeDefined();
    expect(dash.persisted).toBeDefined();
  });

  it("formats dashboard line for console", () => {
    const line = formatPlannerDashboardLine();
    expect(line).toContain("[ripple-p85] dashboard");
  });

  it("tracks cache entries in dashboard", () => {
    storeCachedPlan(
      "open chrome",
      emptyWorld(),
      {
        goal: "test",
        confidence: 0.9,
        steps: [{ tool: "desktop.launch_app", args: { app: "chrome" } }],
        rawUtterance: "open chrome",
        normalizedUtterance: "open chrome",
        source: "GPT",
      },
    );
    const dash = buildPlannerDashboardSummary();
    expect(dash.cacheEntries).toBe(1);
  });

  it("exports planner shadow CSV header", () => {
    const csv = exportPlannerShadowCsv(10);
    expect(csv.startsWith("created_at,raw_utterance")).toBe(true);
  });

  it("records execution observations for P9", () => {
    resetExecutionObservations();
    observeP85Execution({
      command: "open notepad",
      plan: {
        goal: "open notepad",
        confidence: 0.95,
        steps: [{ tool: "desktop.launch_app", args: { app: "notepad" } }],
        rawUtterance: "open notepad",
        normalizedUtterance: "open notepad",
        source: "L0",
      },
      payload: {
        command_id: "test",
        intent: "launch_app",
        actions: [],
      },
      summary: {
        command_id: "test",
        allSucceeded: true,
        records: [{ index: 0, type: "LAUNCH_APP", status: "executed" }],
      },
    });
    expect(getRecentExecutionObservations(5)).toHaveLength(1);
    expect(getRecentExecutionObservations(5)[0]?.succeeded).toBe(true);
  });
});
