import { describe, expect, it, beforeEach } from "vitest";
import { initRippleDb } from "../../storage/rippleDb.js";
import {
  clearTelemetryDb,
  recordCommandEvent,
} from "../commandTelemetry.js";
import { buildObservabilitySummary } from "../observabilityDashboard.js";
import { boostAppFromLaunch } from "../../storage/knowledgeGraph.js";
import {
  resetWorkflowGraphForTests,
  saveWorkflowGraph,
  recordWorkflowRun,
} from "../../storage/workflowGraph.js";

describe("P6 observability dashboard", () => {
  beforeEach(() => {
    initRippleDb();
    clearTelemetryDb();
    resetWorkflowGraphForTests();
  });

  it("computes success rate and planner mix", () => {
    recordCommandEvent({
      command: "Open downloads",
      outcome: "success",
      planner_source: "fast",
      latency_ms: 120,
    });
    recordCommandEvent({
      command: "Open mystery file",
      outcome: "not_found",
      planner_source: "gpt",
      detail: "map_miss",
    });
    recordCommandEvent({
      command: "Delete everything",
      outcome: "blocked",
      permission: "blocked",
      detail: "wildcard",
    });

    const summary = buildObservabilitySummary();
    expect(summary.total).toBeGreaterThanOrEqual(3);
    expect(summary.successRatePercent).toBeGreaterThan(0);
    expect(summary.blockedPermissionCount).toBeGreaterThanOrEqual(1);
    expect(summary.plannerMix.fast).toBeGreaterThanOrEqual(1);
    expect(summary.plannerMix.gpt).toBeGreaterThanOrEqual(1);
    expect(summary.topSearchMisses.length).toBeGreaterThanOrEqual(1);
  });

  it("includes top workflows and apps", () => {
    saveWorkflowGraph("work mode", [{ type: "app", target: "vscode" }]);
    recordWorkflowRun("work mode");
    recordWorkflowRun("work mode");
    boostAppFromLaunch("vscode");
    boostAppFromLaunch("vscode");
    boostAppFromLaunch("chrome");

    const summary = buildObservabilitySummary();
    expect(summary.topWorkflows.some((w) => w.name === "work mode")).toBe(true);
    expect(summary.topApps.length).toBeGreaterThan(0);
  });

  it("exports CSV with header", async () => {
    const { exportTelemetryCsv } = await import("../observabilityDashboard.js");
    recordCommandEvent({ command: "test", outcome: "success" });
    const csv = exportTelemetryCsv(10);
    expect(csv.split("\n")[0]).toContain("created_at,command,outcome");
    expect(csv).toContain("test");
  });
});
