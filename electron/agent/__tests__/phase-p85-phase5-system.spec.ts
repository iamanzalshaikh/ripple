import { describe, expect, it, beforeEach, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import { executePlan } from "../planner/toolExecutor.js";
import { validatePlan } from "../planner/planValidator.js";
import {
  ensureP85ToolsRegistered,
  planEligibleForToolExecutor,
} from "../planner/toolExecutorBridge.js";
import {
  resetPhase1DesktopToolsForTests,
} from "../planner/tools/desktopTools.js";
import {
  resetPhase2FilesystemToolsForTests,
} from "../planner/tools/filesystemTools.js";
import {
  registerPhase1SystemTools,
  resetPhase1SystemToolsForTests,
  listPhase1SystemToolNames,
} from "../planner/tools/systemTools.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/clipboard/clipboardService.js", () => ({
  readClipboardText: vi.fn(() => "hello from clipboard"),
  writeClipboardText: vi.fn(),
}));

import {
  readClipboardText,
  writeClipboardText,
} from "../../automation/clipboard/clipboardService.js";

const stubWorld = (clipboard = "hello"): WorldModel => ({
  capturedAt: 0,
  foreground: null,
  focusedField: null,
  focusContext: null,
  mouse: { x: 0, y: 0, windowUnderCursor: null },
  browser: { surface: null },
  clipboard: {
    hasText: clipboard.length > 0,
    preview: clipboard.slice(0, 40),
    length: clipboard.length,
  },
  capabilities: {
    sidecarConnected: false,
    sendInput: true,
    uia: false,
    ocr: false,
  },
  activeGoal: null,
});

describe("P8.5 Phase 5 — system tools", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase1DesktopToolsForTests();
    resetPhase2FilesystemToolsForTests();
    resetPhase1SystemToolsForTests();
    vi.mocked(readClipboardText).mockReturnValue("hello from clipboard");
    ensureP85ToolsRegistered();
  });

  it("registers clipboard tools", () => {
    const names = listPhase1SystemToolNames();
    expect(names).toContain("system.clipboard.read");
    expect(names).toContain("system.clipboard.write");
    expect(names.length).toBe(2);
  });

  it("executes system.clipboard.read", async () => {
    const summary = await executePlan(
      {
        goal: "read clipboard",
        confidence: 0.95,
        steps: [{ tool: "system.clipboard.read", args: {} }],
        source: "L0",
      },
      { command: "read clipboard", world: stubWorld() },
    );
    expect(summary.ok).toBe(true);
    expect(summary.records[0]?.result.output).toBe("hello from clipboard");
  });

  it("executes system.clipboard.write", async () => {
    const summary = await executePlan(
      {
        goal: "write clipboard",
        confidence: 0.95,
        steps: [
          {
            tool: "system.clipboard.write",
            args: { text: "ripple test" },
          },
        ],
        source: "L0",
      },
      { command: "copy ripple test", world: stubWorld() },
    );
    expect(summary.ok).toBe(true);
    expect(writeClipboardText).toHaveBeenCalledWith("ripple test");
  });

  it("plan is eligible for tool executor with clipboard tools", () => {
    const plan = {
      goal: "clipboard",
      confidence: 0.9,
      steps: [
        { tool: "system.clipboard.read", args: {} },
        { tool: "system.clipboard.write", args: { text: "x" } },
      ],
      source: "L0" as const,
    };
    expect(planEligibleForToolExecutor(plan)).toBe(true);
    expect(validatePlan(plan, stubWorld()).valid).toBe(true);
  });
});
