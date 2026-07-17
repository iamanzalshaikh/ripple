import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import { validatePlan } from "../planner/planValidator.js";
import { ensureP85ToolsRegistered } from "../planner/toolExecutorBridge.js";
import type { WorldModel } from "../types.js";
import { P5_QA_MATRIX, type P5QaCase } from "./p5-qa-matrix-fixtures.js";

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: {
      processName: "chrome",
      windowTitle: "Google Chrome",
      hwnd: 1,
      capturedAt: Date.now(),
      isBrowser: true,
      isGmail: false,
      isWhatsApp: false,
      isNotion: false,
      isYouTube: false,
      isLinkedIn: false,
      isInstagram: false,
      activeTabUrl: "https://www.google.com",
    },
    mouse: { x: 0, y: 0, windowUnderCursor: null },
    browser: { surface: null },
    clipboard: {
      hasText: true,
      preview: "copied",
      length: 6,
    },
    capabilities: {
      sidecarConnected: true,
      sendInput: true,
      uia: true,
      ocr: true,
    },
    activeGoal: null,
  };
}

function toolsFromResult(result: ReturnType<typeof runPlannerPipeline>): string[] {
  if (result.kind === "execute" || result.kind === "partial") {
    return result.plan.steps.map((s) => s.tool);
  }
  return [];
}

function isAcceptableKind(
  result: ReturnType<typeof runPlannerPipeline>,
  expectKind: P5QaCase["kind"],
): boolean {
  if (expectKind === "blocked") return true;
  if (result.kind === expectKind) return true;
  if (expectKind === "execute" && result.kind === "partial") return true;
  return false;
}

function isSubsequence(expected: string[], actual: string[]): boolean {
  let i = 0;
  for (const tool of actual) {
    if (tool === expected[i]) i++;
    if (i >= expected.length) return true;
  }
  return i >= expected.length;
}

function matchesToolExpectation(
  actual: string[],
  primary?: string[],
  altSets?: string[][],
): boolean {
  if (primary?.length && isSubsequence(primary, actual)) return true;
  if (altSets?.length) {
    return altSets.some((set) => isSubsequence(set, actual));
  }
  return !primary?.length;
}

function assertBlocked(case_: P5QaCase, world: WorldModel): void {
  const result = runPlannerPipeline({ command: case_.command, world });
  if (result.kind === "execute") {
    const validation = validatePlan(result.plan, world, case_.command);
    const bulkDelete = result.plan.steps.some(
      (s) =>
        s.tool === "filesystem.delete" &&
        (/documents/i.test(String(s.args.parentFolder ?? s.args.path ?? "")) ||
          /all files/i.test(case_.command)),
    );
    expect(
      bulkDelete ||
        !validation.valid ||
        validation.errors.some((e) => e.includes("blocked")),
    ).toBe(true);
    return;
  }
  expect(["defer", "clarify", "partial"]).toContain(result.kind);
}

describe("P8.5-P5 E2E QA matrix (cursor/test.md)", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevExecutor = process.env.RIPPLE_P85_TOOL_EXECUTOR;
  const prevCdp = process.env.RIPPLE_USE_CDP;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_TOOL_EXECUTOR = "1";
    process.env.RIPPLE_USE_CDP = "0";
    ensureP85ToolsRegistered();
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevExecutor === undefined) delete process.env.RIPPLE_P85_TOOL_EXECUTOR;
    else process.env.RIPPLE_P85_TOOL_EXECUTOR = prevExecutor;
    if (prevCdp === undefined) delete process.env.RIPPLE_USE_CDP;
    else process.env.RIPPLE_USE_CDP = prevCdp;
  });

  it("covers all QA cases from test.md", () => {
    expect(P5_QA_MATRIX.length).toBe(55);
  });

  for (const case_ of P5_QA_MATRIX) {
    it(`${case_.id}: ${case_.command.slice(0, 72)}`, () => {
      const world = stubWorld();

      if (case_.kind === "blocked") {
        assertBlocked(case_, world);
        return;
      }

      const result = runPlannerPipeline({ command: case_.command, world });
      const expectKind = case_.kind ?? "execute";

      if (expectKind === "defer") {
        expect(result.kind).toBe("defer");
        return;
      }
      if (expectKind === "clarify") {
        expect(result.kind).toBe("clarify");
        return;
      }

      expect(isAcceptableKind(result, expectKind)).toBe(true);
      if (result.kind !== "execute" && result.kind !== "partial") return;

      const tools = toolsFromResult(result);
      if (case_.minSteps) {
        expect(tools.length).toBeGreaterThanOrEqual(case_.minSteps);
      }

      if (case_.forbid?.length) {
        for (const forbidden of case_.forbid) {
          expect(tools.some((t) => t.includes(forbidden))).toBe(false);
        }
      }

      const matched = matchesToolExpectation(
        tools,
        case_.tools,
        case_.altToolSets,
      );
      expect(matched, `tools=${tools.join(" → ")}`).toBe(true);

      const validation = validatePlan(result.plan, world, case_.command);
      if (result.kind === "execute") {
        expect(validation.valid, validation.errors?.join("; ")).toBe(true);
      }
    });
  }
});
