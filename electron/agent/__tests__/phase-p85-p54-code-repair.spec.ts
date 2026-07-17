import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { proposeCodeRepairsFromDiagnostics } from "../../automation/shell/proposeCodeRepairs.js";
import {
  clearCodeRepairSessionForTests,
  getPendingCodeRepair,
  recordCodeRepairDiagnostics,
  setPendingCodeRepair,
} from "../planner/codeRepairSession.js";
import {
  isDeveloperWorkflowUtterance,
  tryCodeRepairConfirmPlan,
  tryDeveloperWorkflowPlan,
  tryPlanCodeRepairTail,
} from "../planner/developerWorkflowPlanner.js";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import type { WorldModel } from "../types.js";

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

describe("P5.4 CODE_REPAIR confirm → patch", () => {
  let tempDir: string;

  beforeEach(() => {
    clearCodeRepairSessionForTests();
    tempDir = mkdtempSync(join(tmpdir(), "ripple-repair-"));
    writeFileSync(
      join(tempDir, "broken.ts"),
      ["export const item = {", "  displayOrder:", "};", ""].join("\n"),
      "utf8",
    );
  });

  afterEach(() => {
    clearCodeRepairSessionForTests();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("proposes a safe patch for incomplete property (TS1109)", () => {
    const proposals = proposeCodeRepairsFromDiagnostics(tempDir, [
      {
        file: "broken.ts",
        line: 2,
        column: 16,
        code: "TS1109",
        message: "Expression expected.",
        source: "typescript",
      },
    ]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.find).toContain("displayOrder:");
    expect(proposals[0]?.replace).toMatch(/displayOrder:\s*0/);
  });

  it("proposes Record<string, { for incomplete Record generic (jkf TS2314)", () => {
    writeFileSync(
      join(tempDir, "generic.ts"),
      [
        "export const SEED: Record<",
        "",
        "  {",
        "    thumbnail: string;",
        "  }",
        "> = {};",
        "",
      ].join("\n"),
      "utf8",
    );
    const proposals = proposeCodeRepairsFromDiagnostics(tempDir, [
      {
        file: "generic.ts",
        line: 1,
        column: 20,
        code: "TS2314",
        message: "Generic type 'Record' requires 2 type argument(s).",
        source: "typescript",
      },
    ]);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0]?.replace).toMatch(/Record<\s*\n\s*string,\s*\n\s*\{/);
  });

  it("proposes string for truncated type st (TS2304)", () => {
    writeFileSync(
      join(tempDir, "truncated.ts"),
      [
        "type Seed = {",
        "  centerRedImage?: st",
        "  testimonialBg?: string;",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const proposals = proposeCodeRepairsFromDiagnostics(tempDir, [
      {
        file: "truncated.ts",
        line: 2,
        column: 22,
        code: "TS2304",
        message: "Cannot find name 'st'.",
        source: "typescript",
      },
    ]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.find).toContain("centerRedImage?: st");
    expect(proposals[0]?.replace).toContain("centerRedImage?: string");
  });

  it("auto-tails patch for TS2304 when utterance already asked to apply", () => {
    writeFileSync(
      join(tempDir, "truncated.ts"),
      ["type Seed = {", "  centerRedImage?: st", "};", ""].join("\n"),
      "utf8",
    );
    setPendingCodeRepair({
      projectPath: tempDir,
      wantsTests: false,
      autoApply: true,
      sourceUtterance: "audit and apply the safe fixes",
    });
    recordCodeRepairDiagnostics(tempDir, [
      {
        file: "truncated.ts",
        line: 2,
        column: 22,
        code: "TS2304",
        message: "Cannot find name 'st'.",
        source: "typescript",
      },
    ]);
    const tail = tryPlanCodeRepairTail(["apply the safe fixes from typecheck"], {
      rawCommand: "audit and apply the safe fixes",
      normalized: "audit and apply the safe fixes",
    });
    expect(tail).not.toBeNull();
    expect(tail?.steps[0]?.tool).toBe("filesystem.patch_file");
    expect(String(tail?.steps[0]?.args.replace)).toContain("string");
  });

  it("plans patch_file + typecheck + tests after confirm", () => {
    setPendingCodeRepair({
      projectPath: tempDir,
      wantsTests: true,
      sourceUtterance: "open and fix",
    });
    recordCodeRepairDiagnostics(tempDir, [
      {
        file: "broken.ts",
        line: 2,
        column: 16,
        code: "TS1109",
        message: "Expression expected.",
        source: "typescript",
      },
    ]);

    const result = tryCodeRepairConfirmPlan("yes, apply fixes", "yes apply fixes");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;

    const tools = result.plan.steps.map((s) => s.tool);
    expect(tools[0]).toBe("filesystem.patch_file");
    expect(tools).toContain("automation.typecheck");
    expect(tools).toContain("automation.run_tests");
    expect(result.plan.steps[0]?.args.find).toContain("displayOrder:");
    expect(getPendingCodeRepair()).toBeNull();
  });

  it("clarifies when confirm has no safe auto-fix", () => {
    writeFileSync(
      join(tempDir, "typed.ts"),
      "export const n: number = \"oops\";\n",
      "utf8",
    );
    setPendingCodeRepair({
      projectPath: tempDir,
      wantsTests: false,
      sourceUtterance: "fix",
    });
    recordCodeRepairDiagnostics(tempDir, [
      {
        file: "typed.ts",
        line: 1,
        column: 1,
        code: "TS2322",
        message: "Type string is not assignable to type number",
        source: "typescript",
      },
    ]);

    const result = tryCodeRepairConfirmPlan("confirm", "confirm");
    expect(result?.kind).toBe("clarify");
    if (result?.kind === "clarify") {
      expect(result.reason).toBe("code_repair_no_safe_patch");
    }
  });

  it("pipeline routes confirm to execute plan after pending repair", () => {
    setPendingCodeRepair({
      projectPath: tempDir,
      wantsTests: false,
      sourceUtterance: "fix",
    });
    recordCodeRepairDiagnostics(tempDir, [
      {
        file: "broken.ts",
        line: 2,
        column: 16,
        code: "TS1109",
        message: "Expression expected.",
        source: "typescript",
      },
    ]);

    const result = runPlannerPipeline({
      command: "yes apply fixes",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps.some((s) => s.tool === "filesystem.patch_file")).toBe(
      true,
    );
  });

  it("matches apply the safe fixes as repair and auto-applies after audit", () => {
    const cmd =
      "Open my project at C:\\Users\\ANZAL\\Desktop\\jkf (furniture), audit the codebase, find TypeScript errors, apply the safe fixes, then run the project tests.";
    const result = tryDeveloperWorkflowPlan(cmd, cmd);
    expect(result?.kind).toBe("partial");
    if (result?.kind !== "partial") return;
    expect(result.unresolvedClauses.some((c) => /safe fixes|apply/i.test(c))).toBe(
      true,
    );
    expect(result.plan.steps.map((s) => s.tool)).not.toContain("automation.run_tests");
    expect(getPendingCodeRepair()?.autoApply).toBe(true);
  });

  it("pathless analyze-and-check-bugs is a single workflow plan (not compound clarify)", () => {
    const cmd = "Analyze the code and check is there any bug or issue in the code";
    expect(isDeveloperWorkflowUtterance(cmd, cmd)).toBe(true);
    const result = tryDeveloperWorkflowPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    const tools = result.plan.steps.map((s) => s.tool);
    expect(tools).toContain("automation.scan_project");
    expect(tools).toContain("automation.analyze_codebase");
    expect(tools).toContain("automation.typecheck");
    expect(tools).toContain("automation.lint");

    const pipeline = runPlannerPipeline({ command: cmd, world: stubWorld() });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(pipeline.plan.steps.some((s) => s.tool === "automation.analyze_codebase")).toBe(
      true,
    );
  });

  it("builds auto-tail patch when diagnostics point at }, line", () => {
    setPendingCodeRepair({
      projectPath: tempDir,
      wantsTests: false,
      autoApply: true,
      sourceUtterance: "apply the safe fixes",
    });
    recordCodeRepairDiagnostics(tempDir, [
      {
        file: "broken.ts",
        line: 3,
        column: 1,
        code: "TS1109",
        message: "Expression expected.",
        source: "typescript",
      },
    ]);

    const tail = tryPlanCodeRepairTail(
      ["apply the safe fixes from typecheck"],
      { rawCommand: "apply", normalized: "apply" },
    );
    expect(tail?.steps[0]?.tool).toBe("filesystem.patch_file");
  });

  it("audit with after confirmation still requires voice confirm (autoApply=false)", () => {
    const cmd = `Open the project "${tempDir}", find any existing code issues, fix the problems in the affected files after confirmation, and run the project tests`;
    const result = tryDeveloperWorkflowPlan(cmd, cmd);
    expect(result?.kind).toBe("partial");
    const pending = getPendingCodeRepair();
    expect(pending?.projectPath).toBe(tempDir);
    expect(pending?.wantsTests).toBe(true);
    expect(pending?.autoApply).toBe(false);
  });
});
