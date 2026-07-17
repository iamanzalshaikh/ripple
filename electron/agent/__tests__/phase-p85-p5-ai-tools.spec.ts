import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  generateActionPlanHeuristic,
  parseActionPlanDraftOutput,
  reasonAboutTaskHeuristic,
  sanitizeActionPlanDraft,
} from "../../automation/ai/aiHelpers.js";
import {
  listPhase5AiToolNames,
  registerPhase5AiTools,
  resetPhase5AiToolsForTests,
} from "../planner/tools/aiTools.js";
import { clearRegisteredToolsForTests, getRegisteredTool } from "../planner/toolRegistry.js";
import { tryL0AiPlan } from "../planner/l0AiPlanner.js";
import { executePlan } from "../planner/toolExecutor.js";
import { isKnownTool, TOOL_MANIFEST_VERSION } from "../planner/toolDefinitions.js";
import type { WorldModel } from "../types.js";

vi.mock("../../native/win32Bridge.js", () => ({
  screenshotOcrNative: vi.fn(async () => ({
    text: "Login\nPassword\nSave changes",
    width: 800,
    height: 600,
    lineCount: 3,
  })),
  getWindowRectCenter: vi.fn(async () => ({ x: 400, y: 300 })),
  mouseClickNative: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../focus/focusContext.js", () => ({
  getFocusContext: () => ({
    hwnd: 42,
    processName: "Cursor",
    windowTitle: "project-content.ts - jkf",
    capturedAt: Date.now(),
    isGmail: false,
    isWhatsApp: false,
    isSlack: false,
    isNotion: false,
    isYouTube: false,
    isLinkedIn: false,
    isInstagram: false,
    isBrowser: false,
  }),
  resolveTypingFocusTarget: () => null,
}));

vi.mock("electron", () => ({
  clipboard: {
    readText: () => "hello clipboard",
    writeText: vi.fn(),
  },
}));

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
    ocr: true,
  },
  activeGoal: null,
});

describe("P8.5-P5.5 AI tools", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase5AiToolsForTests();
    registerPhase5AiTools();
  });

  afterEach(() => {
    clearRegisteredToolsForTests();
    resetPhase5AiToolsForTests();
  });

  it("registers ai.* tools including explain_active_editor_file", () => {
    const names = listPhase5AiToolNames();
    expect(names).toContain("ai.explain_active_editor_file");
    expect(names).toContain("ai.summarize_screen");
    expect(names).toEqual([
      "ai.explain_active_editor_file",
      "ai.summarize_screen",
      "ai.extract_context",
      "ai.detect_element",
      "ai.reason_about_task",
      "ai.generate_action_plan",
    ]);
    for (const name of names) {
      expect(getRegisteredTool(name)).toBeDefined();
      expect(isKnownTool(name)).toBe(true);
    }
    expect(TOOL_MANIFEST_VERSION).toBe("2.2.0");
  });

  it("L0 routes explain this code to ai.explain_active_editor_file (not insert)", () => {
    const plan = tryL0AiPlan(
      "Explain this code like a senior engineer",
      "explain this code like a senior engineer",
    );
    expect(plan?.kind).toBe("plan");
    if (plan?.kind !== "plan") return;
    expect(plan.plan.steps[0]?.tool).toBe("ai.explain_active_editor_file");
  });

  it("L0 routes summarize / reason / generate plan", () => {
    expect(tryL0AiPlan("what is on my screen", "what is on my screen")?.kind).toBe(
      "plan",
    );
    expect(
      tryL0AiPlan("what should I do next to fix TypeScript errors", "what should i do next")
        ?.plan.steps[0]?.tool,
    ).toBe("ai.reason_about_task");
    expect(
      tryL0AiPlan("make a plan to audit my project", "make a plan to audit my project")
        ?.plan.steps[0]?.tool,
    ).toBe("ai.generate_action_plan");
  });

  it("routes screen / OCR / element phrases (not open_project)", () => {
    expect(
      tryL0AiPlan("Analyze my current screen", "Analyze my current screen")?.plan
        .steps[0]?.tool,
    ).toBe("ai.summarize_screen");
    expect(
      tryL0AiPlan("What is visible on my screen", "What is visible on my screen")
        ?.plan.steps[0]?.tool,
    ).toBe("ai.summarize_screen");
    expect(
      tryL0AiPlan("Explain this page", "Explain this page")?.plan.steps[0]?.tool,
    ).toBe("ai.summarize_screen");
    expect(
      tryL0AiPlan(
        "Find important elements on this screen",
        "Find important elements on this screen",
      )?.plan.steps[0]?.tool,
    ).toBe("ai.detect_element");
    // Defense if NLU wrongly rewrote Find → Open my
    expect(
      tryL0AiPlan(
        "Open my important elements on this screen",
        "Open my important elements on this screen",
      )?.plan.steps[0]?.tool,
    ).toBe("ai.detect_element");
  });

  it("reason_about_task is heuristic and side-effect free", () => {
    const r = reasonAboutTaskHeuristic("fix TypeScript errors in jkf");
    expect(r.suggestedNextSteps.length).toBeGreaterThan(0);
    expect(r.source).toBe("heuristic");
  });

  it("generate_action_plan draft never includes mutating tools or nested generate", () => {
    const draft = generateActionPlanHeuristic(
      "audit and fix my project",
      "audit and fix my project",
      "audit and fix my project",
    );
    expect(draft.plan.steps.every((s) => s.tool.startsWith("ai."))).toBe(true);
    expect(
      draft.plan.steps.some((s) => s.tool === "ai.generate_action_plan"),
    ).toBe(false);

    const sneaky = sanitizeActionPlanDraft({
      ...draft.plan,
      steps: [
        ...draft.plan.steps,
        {
          tool: "ai.generate_action_plan",
          args: { goal: "loop" },
          reason: "bad",
        },
        {
          tool: "filesystem.delete",
          args: { path: "C:\\Windows\\System32" },
          reason: "bad",
        },
      ],
    });
    expect(
      sneaky.steps.some((s) => s.tool === "ai.generate_action_plan"),
    ).toBe(false);
    expect(sneaky.steps.some((s) => s.tool === "filesystem.delete")).toBe(false);
  });

  it("ai.generate_action_plan tool does not call executePlan (draft only in tool)", async () => {
    const tool = getRegisteredTool("ai.generate_action_plan");
    expect(tool).toBeDefined();
    const result = await tool!.execute(
      {
        command: "make a plan to audit",
        stepIndex: 0,
        execution: {
          world: stubWorld(),
          resolved: {},
          capabilities: {
            capturedAt: 0,
            manifestVersion: "2.0.0",
            registeredTools: [],
            native: { sendInput: true, uia: false, ocr: true, sidecarUp: false },
            extensions: {},
            permissions: {},
          },
          currentApp: null,
          focusedWindow: null,
          clipboard: { hasText: false, preview: "" },
          selection: null,
          recentTool: null,
          currentFolder: null,
          recentFile: null,
          lastStepOutput: null,
        },
      },
      { goal: "audit my project" },
    );
    expect(result.ok).toBe(true);
    const draft = parseActionPlanDraftOutput(result.output);
    expect(draft).not.toBeNull();
    expect(draft!.steps.length).toBeGreaterThan(0);
  });

  it("executes summarize_screen via mocked OCR", async () => {
    const summary = await executePlan(
      {
        goal: "summarize",
        confidence: 0.9,
        steps: [{ tool: "ai.summarize_screen", args: {}, reason: "test" }],
        rawUtterance: "what is on my screen",
        normalizedUtterance: "what is on my screen",
        source: "L0",
      },
      { command: "what is on my screen", world: stubWorld() },
    );
    expect(summary.ok).toBe(true);
    expect(String(summary.records[0]?.result.output)).toMatch(/Screen OCR|Login/i);
  });

  it("detect_element finds OCR line estimate", async () => {
    const tool = getRegisteredTool("ai.detect_element")!;
    const result = await tool.execute(
      {
        command: "find Save button",
        stepIndex: 0,
        execution: {
          world: stubWorld(),
          resolved: {},
          capabilities: {
            capturedAt: 0,
            manifestVersion: "2.0.0",
            registeredTools: [],
            native: { sendInput: true, uia: false, ocr: true, sidecarUp: false },
            extensions: {},
            permissions: {},
          },
          currentApp: null,
          focusedWindow: null,
          clipboard: { hasText: false, preview: "" },
          selection: null,
          recentTool: null,
          currentFolder: null,
          recentFile: null,
          lastStepOutput: null,
        },
      },
      { query: "Save" },
    );
    expect(result.ok).toBe(true);
    expect(String(result.output)).toMatch(/"found": true/);
  });
});
