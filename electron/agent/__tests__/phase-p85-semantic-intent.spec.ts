import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import {
  classifySemanticIntent,
  preferRawForSemantic,
  shouldBypassSemanticIntent,
  trySemanticIntentPlan,
} from "../planner/semanticIntentRouter.js";
import { tryCompoundGate } from "../planner/compoundGate.js";
import { normalizeForNlu } from "../../automation/voice/nlu/normalizeIntent.js";
import { preprocessForNlu } from "../../automation/voice/nlu/preprocess.js";
import type { WorldModel } from "../types.js";
import { INHERIT_PROJECT_ROOT } from "../planner/inheritContext.js";

const stubWorld = (): WorldModel => ({
  capturedAt: 0,
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
  },
  activeGoal: null,
});

function toolsOf(command: string): string[] {
  const result = runPlannerPipeline({ command, world: stubWorld() });
  expect(result.kind).toBe("execute");
  if (result.kind !== "execute") return [];
  return result.plan.steps.map((s) => s.tool);
}

describe("P8.5 Semantic Intent Router", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
  });
  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
  });

  it("classifies bro check my code as CODE_ANALYSIS", () => {
    const intent = classifySemanticIntent("Bro check my code");
    expect(intent.intent).toBe("CODE_ANALYSIS");
    expect(intent.confidence).toBeGreaterThan(0.75);
    expect(intent.target).toBe("CURRENT_PROJECT");
  });

  it("plans roadmap (not not_found / suggestions)", () => {
    const tools = toolsOf("Create a roadmap to complete this project");
    expect(tools).toContain("automation.scan_project");
    expect(tools).toContain("ai.synthesize_report");
    expect(tools).not.toContain("automation.open_project");
    expect(tools).not.toContain("desktop.launch_app");
  });

  it("plans compare vs production standards", () => {
    const tools = toolsOf(
      "Compare my implementation with production standards",
    );
    expect(tools).toContain("automation.analyze_codebase");
    expect(tools).toContain("ai.synthesize_report");
    expect(tools).not.toContain("automation.lint");
  });

  it("plans requirements gap without open_project", () => {
    const corrupted = normalizeForNlu(
      "Find missing requirements in my current project",
    );
    expect(corrupted.toLowerCase()).not.toMatch(/open my missing/);
    const tools = toolsOf("Find missing requirements in my current project");
    expect(tools).toContain("ai.synthesize_report");
    expect(tools).toContain("automation.analyze_codebase");
    expect(tools).not.toContain("automation.open_project");
  });

  it("plans security review without fake lint-only success", () => {
    const tools = toolsOf("Perform a security review");
    expect(tools).toContain("automation.find_code");
    expect(tools).toContain("ai.synthesize_report");
    expect(tools).not.toContain("automation.lint");
    expect(tools).not.toContain("automation.typecheck");
  });

  it("plans dependency audit via npm outdated/audit", () => {
    const result = runPlannerPipeline({
      command: "Analyze outdated and risky dependencies",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    const cmds = result.plan.steps
      .filter((s) => s.tool === "automation.run_command")
      .map((s) => String(s.args.command ?? ""));
    expect(cmds.some((c) => /npm\s+outdated/i.test(c))).toBe(true);
    expect(cmds.some((c) => /npm\s+audit/i.test(c))).toBe(true);
    expect(result.plan.steps.map((s) => s.tool)).toContain("ai.synthesize_report");
    expect(result.plan.steps.map((s) => s.tool)).not.toContain("automation.lint");
  });

  it("plans check → summarize → Notepad compound fully", () => {
    const tools = toolsOf(
      "Check the issue, summarize it, and make a note in Notepad",
    );
    expect(tools).toContain("automation.analyze_codebase");
    expect(tools).toContain("ai.synthesize_report");
    expect(tryCompoundGate(
      "Check the issue, summarize it, and make a note in Notepad",
      "Check the issue, summarize it, and make a note in Notepad",
    )).toBeNull();
  });

  it("plans CODE_ANALYSIS for bro check my code", () => {
    const result = runPlannerPipeline({
      command: "Bro check my code",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps.map((s) => s.tool)).toEqual([
      "automation.scan_project",
      "automation.analyze_codebase",
      "automation.typecheck",
      "ai.synthesize_report",
    ]);
    for (const step of result.plan.steps) {
      if ("projectRoot" in step.args) {
        expect(step.args.projectRoot).toBe(INHERIT_PROJECT_ROOT);
      }
    }
  });

  it("bypasses Semantic for Open Chrome", () => {
    expect(shouldBypassSemanticIntent("Open Chrome")).toBe(true);
    expect(trySemanticIntentPlan("Open Chrome", "Open Chrome")).toBeNull();
  });

  it("prefers raw Find when NLU rewrote to Open my", () => {
    const raw = "Find missing requirements in my current project";
    const nlu = "Open my missing requirements in my current project";
    expect(preferRawForSemantic(raw, nlu).toLowerCase()).toMatch(/^find/);
    expect(classifySemanticIntent(raw, nlu).intent).toBe("REQUIREMENTS_GAP");
  });

  it("preprocess keeps Find missing requirements", () => {
    const out = preprocessForNlu(
      "Find missing requirements in my current project",
    );
    expect(out.nlu.toLowerCase()).toMatch(/find missing requirements/);
    expect(out.nlu.toLowerCase()).not.toMatch(/open my missing/);
  });
});
