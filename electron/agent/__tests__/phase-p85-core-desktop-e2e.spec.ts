import { describe, expect, it, beforeEach, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import { executePlan } from "../planner/toolExecutor.js";
import {
  resetPhase1DesktopToolsForTests,
  registerPhase1DesktopTools,
} from "../planner/tools/desktopTools.js";
import type { ExecutionPlan } from "../planner/planTypes.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/actions/insertText.js", () => ({
  runInsertText: vi.fn(async (data?: Record<string, unknown>) => {
    const text = typeof data?.text === "string" ? data.text : "";
    if (text) return `Typed ${text}`;
    const keys = typeof data?.keys === "string" ? data.keys : "";
    if (keys) return `Sent keys ${keys}`;
    return "desktop_input_ok";
  }),
}));

vi.mock("../../automation/desktop/launchApp.js", () => ({
  launchNativeApp: vi.fn(async () => "Launched notepad"),
}));

vi.mock("../../automation/desktop/nativeAppRegistry.js", () => ({
  resolveNativeApp: vi.fn((name: string) =>
    name ? { id: name, name, exe: `${name}.exe` } : null,
  ),
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

const CORE_TOOLS = [
  { tool: "desktop.type_text", args: { text: "hello" } },
  { tool: "desktop.copy", args: {} },
  { tool: "desktop.paste", args: {} },
  { tool: "desktop.press_keys", args: { keys: "^c" } },
  { tool: "desktop.launch_app", args: { app: "notepad" } },
] as const;

describe("P8.5 core desktop tools — executor E2E (mocked OS)", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase1DesktopToolsForTests();
    registerPhase1DesktopTools();
  });

  for (const step of CORE_TOOLS) {
    it(`executes ${step.tool} through tool executor`, async () => {
      const plan: ExecutionPlan = {
        goal: step.tool,
        confidence: 1,
        steps: [{ tool: step.tool, args: { ...step.args } }],
        rawUtterance: step.tool,
        normalizedUtterance: step.tool,
        source: "L0",
      };

      const summary = await executePlan(plan, {
        command: step.tool,
        world: stubWorld(),
      });

      expect(summary.ok).toBe(true);
      expect(summary.records[0]?.result.ok).toBe(true);
    });
  }
});
