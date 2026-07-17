import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { parseAutomationClause } from "../planner/parseAutomationClause.js";
import { automationIntentToPlanSteps } from "../planner/automationIntentToPlanSteps.js";
import { classifyClauses } from "../planner/v2/clauseClassifier.js";
import { routeRecordToSteps } from "../planner/v2/toolRoutingMatrix.js";
import { splitCompoundParts } from "../../automation/voice/nlu/compoundParse.js";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import { INHERIT_PROJECT_ROOT } from "../planner/inheritContext.js";
import { tryCompoundGate } from "../planner/compoundGate.js";
import { isDeveloperWorkflowUtterance } from "../planner/developerWorkflowPlanner.js";

const JKF_CMD =
  'Open the project C:\\Users\\ANZAL\\Desktop\\jkf (furniture), analyze the entire codebase, identify any errors, bugs, broken functionality, or potential issues, find affected files, explain root cause, apply fixes, and run tests';
const REPORTED_CMD =
  'Open the project "C:\\Users\\ANZAL\\Desktop\\jkf (furniture)", find any existing code issues, fix the problems in the affected files after confirmation, and run the project tests to verify the fixes';
const REPORTED_CMD_NLU_CORRUPT =
  'Open the project "C:\\Users\\ANZAL\\desktop\\jkf (furniture)", open my any existing code issues, fix the problems in the affected files after confirmation, and run the project tests to verify the fixes';

describe("P5.4 compound automation routing", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
  });
  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
  });

  it("parses open project with Windows path as automation.open_project", () => {
    const intent = parseAutomationClause(
      "Open the project C:\\Users\\ANZAL\\Desktop\\jkf (furniture)",
    );
    expect(intent?.kind).toBe("open_project");
    expect(intent && "path" in intent ? intent.path : "").toContain("jkf");
    const steps = automationIntentToPlanSteps(intent!);
    expect(steps[0]?.tool).toBe("automation.open_project");
  });

  it("parses natural folder names as projectHint for index resolution", () => {
    expect(parseAutomationClause("Open my furniture project")).toEqual({
      kind: "open_project",
      projectHint: "furniture",
    });
    expect(parseAutomationClause("Open jkf folder from desktop")).toEqual({
      kind: "open_project",
      projectHint: "jkf desktop",
    });
  });

  it("stops a quoted Windows path at its closing quote", () => {
    const intent = parseAutomationClause(
      'Open the project "C:\\Users\\ANZAL\\Desktop\\jkf (furniture)" open my any existing code issues',
    );
    expect(intent).toEqual({
      kind: "open_project",
      path: "C:\\Users\\ANZAL\\Desktop\\jkf (furniture)",
    });
  });

  it("maps analyze codebase to scan + analyze + typecheck", () => {
    const steps = automationIntentToPlanSteps(
      parseAutomationClause("analyze the entire codebase")!,
    );
    expect(steps.map((s) => s.tool)).toEqual([
      "automation.scan_project",
      "automation.analyze_codebase",
      "automation.typecheck",
    ]);
  });

  it("maps typescript typecheck to automation.typecheck", () => {
    const intent = parseAutomationClause("run typescript typecheck");
    expect(intent?.kind).toBe("typecheck");
    expect(automationIntentToPlanSteps(intent!)[0]?.tool).toBe(
      "automation.typecheck",
    );
  });

  it("maps run tests variants to automation.run_tests", () => {
    for (const phrase of [
      "run tests",
      "run the appropriate project tests",
      "verify changes",
    ]) {
      const intent = parseAutomationClause(phrase);
      expect(intent?.kind).toBe("run_tests");
    }
  });

  it("splits the jkf compound into multiple automation clauses", () => {
    const parts = splitCompoundParts(JKF_CMD);
    expect(parts).not.toBeNull();
    expect(parts!.length).toBeGreaterThanOrEqual(5);

    const records = classifyClauses(parts!);
    const types = records.map((r) => r.clauseType);
    expect(types[0]).toBe("AUTOMATION");
    expect(types.filter((t) => t === "AUTOMATION").length).toBeGreaterThanOrEqual(4);

    const tools = records
      .map((r) => routeRecordToSteps(r)?.map((s) => s.tool) ?? [])
      .flat();
    expect(tools).toContain("automation.open_project");
    expect(tools).toContain("automation.find_code");
    expect(tools).toContain("automation.run_tests");
    expect(tools).not.toContain("filesystem.open");
  });

  it("plans compound jkf command as partial multi-step (not FILE_OPEN only)", () => {
    const result = runPlannerPipeline({
      command: JKF_CMD,
      world: {
        capturedAt: 0,
        foreground: null,
        focusedField: null,
        focusContext: null,
        mouse: { x: 0, y: 0, windowUnderCursor: null },
        browser: { surface: null },
        clipboard: { hasText: false, preview: "", length: 0 },
        capabilities: {
          browser: false,
          filesystem: true,
          desktop: true,
          memory: false,
          automation: true,
        },
      },
    });
    expect(["partial", "execute", "clarify", "defer"]).toContain(result.kind);
    if (result.kind === "partial" || result.kind === "execute") {
      const tools = result.plan.steps.map((s) => s.tool);
      expect(tools).toContain("automation.open_project");
      expect(tools.length).toBeGreaterThan(2);
      expect(tools).not.toEqual(["filesystem.open"]);
    }
  });

  it("plans reported repair command safely and defers patch/tests", () => {
    const result = runPlannerPipeline({
      command: REPORTED_CMD,
      world: {
        capturedAt: 0,
        foreground: null,
        focusedField: null,
        focusContext: null,
        mouse: { x: 0, y: 0, windowUnderCursor: null },
        browser: { surface: null },
        clipboard: { hasText: false, preview: "", length: 0 },
        capabilities: {
          browser: false,
          filesystem: true,
          desktop: true,
          memory: false,
          automation: true,
        },
      },
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.plan.steps).toEqual([
      {
        tool: "automation.open_project",
        args: { path: "C:\\Users\\ANZAL\\Desktop\\jkf (furniture)" },
        reason: "developer_workflow_open_project",
      },
      {
        tool: "automation.scan_project",
        args: { projectRoot: INHERIT_PROJECT_ROOT },
        reason: "developer_workflow_scan_project",
      },
      {
        tool: "automation.analyze_codebase",
        args: { projectRoot: INHERIT_PROJECT_ROOT },
        reason: "developer_workflow_analyze_codebase",
      },
      {
        tool: "automation.typecheck",
        args: { projectRoot: INHERIT_PROJECT_ROOT },
        reason: "developer_workflow_typecheck",
      },
      {
        tool: "automation.lint",
        args: { projectRoot: INHERIT_PROJECT_ROOT },
        reason: "developer_workflow_lint",
      },
    ]);
    expect(result.unresolvedClauses).toContain(
      "fix the affected files after confirmation",
    );
    expect(result.unresolvedClauses).toContain(
      "run the project tests after the fix",
    );
  });

  it("extracts clean path from unquoted audit utterance in developer workflow", () => {
    const cmd =
      "Open project C:\\Users\\ANZAL\\Desktop\\jkf (furniture). Perform a full code audit. Check TypeScript errors";
    const result = runPlannerPipeline({
      command: cmd,
      world: {
        capturedAt: 0,
        foreground: null,
        focusedField: null,
        focusContext: null,
        mouse: { x: 0, y: 0, windowUnderCursor: null },
        browser: { surface: null },
        clipboard: { hasText: false, preview: "", length: 0 },
        capabilities: {
          browser: false,
          filesystem: true,
          desktop: true,
          memory: false,
          automation: true,
        },
      },
    });
    expect(result.kind).not.toBe("defer");
    if (result.kind === "partial" || result.kind === "execute") {
      const open = result.plan.steps[0];
      expect(open?.args.path).toBe("C:\\Users\\ANZAL\\Desktop\\jkf (furniture)");
      expect(String(open?.args.path)).not.toMatch(/Perform|Check TypeScript/i);
    }
  });

  it("routes NLU-corrupted repair utterance through developer workflow, not compound v2", () => {
    expect(isDeveloperWorkflowUtterance(REPORTED_CMD_NLU_CORRUPT)).toBe(true);
    expect(tryCompoundGate(REPORTED_CMD_NLU_CORRUPT, REPORTED_CMD_NLU_CORRUPT)).toBeNull();

    const result = runPlannerPipeline({
      command: REPORTED_CMD_NLU_CORRUPT,
      world: {
        capturedAt: 0,
        foreground: null,
        focusedField: null,
        focusContext: null,
        mouse: { x: 0, y: 0, windowUnderCursor: null },
        browser: { surface: null },
        clipboard: { hasText: false, preview: "", length: 0 },
        capabilities: {
          browser: false,
          filesystem: true,
          desktop: true,
          memory: false,
          automation: true,
        },
      },
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.plan.steps.map((s) => s.tool)).toEqual([
      "automation.open_project",
      "automation.scan_project",
      "automation.analyze_codebase",
      "automation.typecheck",
      "automation.lint",
    ]);
  });
});
