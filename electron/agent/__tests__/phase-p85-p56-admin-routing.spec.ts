import { describe, expect, it } from "vitest";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import type { WorldModel } from "../types.js";

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, deviceUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: false, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: false,
      sendInput: true,
      uia: false,
      ocr: false,
      globalHotkey: false,
      elevationInjection: false,
    },
  };
}

/**
 * W0.1 / W0.5 — "run X as administrator" must route to os.run_as_admin, never
 * be swallowed by automation.run_command's literal shell passthrough.
 * Regression for FEATURE_GAPS §3.1 (false SUCCESS on fake admin elevation).
 */
describe("P8.5-P5.6 W0 — admin phrase routing", () => {
  it("routes 'Run notepad as administrator' to os.run_as_admin only", () => {
    const result = runPlannerPipeline({
      command: "Run notepad as administrator",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    const tools = result.plan.steps.map((s) => s.tool);
    expect(tools).toContain("os.run_as_admin");
    expect(tools).not.toContain("automation.run_command");
  });

  it("routes 'Open terminal as administrator' to os.run_as_admin only", () => {
    const result = runPlannerPipeline({
      command: "Open terminal as administrator",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    const tools = result.plan.steps.map((s) => s.tool);
    expect(tools).not.toContain("automation.run_command");
  });

  it("plain 'Run ipconfig' still routes to automation.run_command (not blocked)", () => {
    const result = runPlannerPipeline({
      command: "Run ipconfig",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    const tools = result.plan.steps.map((s) => s.tool);
    expect(tools).toContain("automation.run_command");
  });
});
