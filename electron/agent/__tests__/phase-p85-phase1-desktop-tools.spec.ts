import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../../automation/actions/insertText.js", () => ({
  runInsertText: vi.fn(async (data?: Record<string, unknown>) => {
    const text = typeof data?.text === "string" ? data.text : "";
    if (text) return `Typed ${text}`;
    const keys = typeof data?.keys === "string" ? data.keys : "";
    if (keys) return `Sent keys ${keys}`;
    return "desktop_input_ok";
  }),
}));
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import { executePlan } from "../planner/toolExecutor.js";
import {
  planEligibleForToolExecutor,
  ensurePhase1ToolsRegistered,
} from "../planner/toolExecutorBridge.js";
import {
  resetPhase1DesktopToolsForTests,
  registerPhase1DesktopTools,
  listPhase1DesktopToolNames,
} from "../planner/tools/desktopTools.js";
import type { ExecutionPlan } from "../planner/planTypes.js";
import type { WorldModel } from "../types.js";

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

describe("P8.5 Phase 1 — desktop tools", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase1DesktopToolsForTests();
  });

  it("registers all Phase 1 desktop tools", () => {
    registerPhase1DesktopTools();
    const names = listPhase1DesktopToolNames();
    expect(names).toContain("desktop.type_text");
    expect(names).toContain("desktop.launch_app");
    expect(names).toContain("desktop.focus_window");
    expect(names).toContain("desktop.mouse_scroll");
    expect(names).toContain("desktop.get_active_window");
    expect(names).toContain("desktop.press_key");
    expect(names).toContain("desktop.hotkey");
    expect(names).toContain("desktop.close_app");
    expect(names.length).toBe(18);
  });

  it("executes type_text through registered handler", async () => {
    registerPhase1DesktopTools();
    const summary = await executePlan(typePlan(), {
      command: "type hello",
      world: stubWorld(),
    });

    expect(summary.ok).toBe(true);
    expect(summary.records).toHaveLength(1);
    expect(summary.records[0]).toMatchObject({
      index: 0,
      tool: "desktop.type_text",
      result: { ok: true },
    });
    expect(typeof summary.records[0]?.result.output).toBe("string");
  });

  it("planEligibleForToolExecutor true for registered insert tools", () => {
    ensurePhase1ToolsRegistered();
    expect(
      planEligibleForToolExecutor({
        goal: "copy",
        confidence: 1,
        steps: [{ tool: "desktop.copy", args: {} }],
        rawUtterance: "copy",
        normalizedUtterance: "copy",
        source: "L0",
      }),
    ).toBe(true);
  });

  it("planEligibleForToolExecutor false for _desktopPayload bridge steps", () => {
    ensurePhase1ToolsRegistered();
    expect(
      planEligibleForToolExecutor({
        goal: "open",
        confidence: 1,
        steps: [
          {
            tool: "desktop.launch_app",
            args: { _desktopPayload: { command_id: "x" } },
          },
        ],
        rawUtterance: "open x",
        normalizedUtterance: "open x",
        source: "L0",
      }),
    ).toBe(false);
  });

  it("ensurePhase1ToolsRegistered re-registers after registry clear", () => {
    ensurePhase1ToolsRegistered();
    clearRegisteredToolsForTests();
    ensurePhase1ToolsRegistered();
    expect(
      planEligibleForToolExecutor({
        goal: "paste",
        confidence: 1,
        steps: [{ tool: "desktop.paste", args: {} }],
        rawUtterance: "paste",
        normalizedUtterance: "paste",
        source: "L0",
      }),
    ).toBe(true);
  });
});
