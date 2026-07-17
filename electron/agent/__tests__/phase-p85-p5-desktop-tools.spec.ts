import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1DesktopTools,
  resetPhase1DesktopToolsForTests,
} from "../planner/tools/desktopTools.js";
import { getRegisteredTool } from "../planner/toolRegistry.js";
import { validatePlan } from "../planner/planValidator.js";
import { insertDataFromPlanStep } from "../planner/executionPlanToPayload.js";
import { isHotkeyChord } from "../../automation/input/keyArgs.js";
import type { WorldModel } from "../types.js";

const getForegroundWindow = vi.fn();
const getFocusedA11yElement = vi.fn();
const closeWindowByHwnd = vi.fn();

vi.mock("../../native/win32Bridge.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../native/win32Bridge.js")>();
  return {
    ...actual,
    getForegroundWindow: (...args: unknown[]) => getForegroundWindow(...args),
    getFocusedA11yElement: (...args: unknown[]) =>
      getFocusedA11yElement(...args),
    closeWindowByHwnd: (...args: unknown[]) => closeWindowByHwnd(...args),
    runInputSequenceNative: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock("../../automation/actions/insertText.js", () => ({
  runInsertText: vi.fn(async () => "ok"),
}));

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, windowUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: false, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: true,
      sendInput: true,
      uia: true,
      ocr: true,
    },
    activeGoal: null,
  };
}

describe("P8.5-P5.2 desktop tools", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase1DesktopToolsForTests();
    registerPhase1DesktopTools();
    getForegroundWindow.mockResolvedValue({
      hwnd: 42,
      processName: "notepad",
      windowTitle: "Untitled - Notepad",
    });
    getFocusedA11yElement.mockResolvedValue({
      name: "Text Editor",
      controlType: "ControlType.Document",
      className: "Edit",
    });
    closeWindowByHwnd.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers P5.2 desktop tools", () => {
    expect(getRegisteredTool("desktop.get_active_window")).toBeDefined();
    expect(getRegisteredTool("desktop.get_current_workspace")).toBeDefined();
    expect(getRegisteredTool("desktop.press_key")).toBeDefined();
    expect(getRegisteredTool("desktop.hotkey")).toBeDefined();
    expect(getRegisteredTool("desktop.close_app")).toBeDefined();
  });

  it("desktop.get_active_window returns foreground metadata", async () => {
    const tool = getRegisteredTool("desktop.get_active_window");
    const result = await tool!.execute({} as never, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toMatchObject({
      hwnd: 42,
      processName: "notepad",
      windowTitle: "Untitled - Notepad",
      focusedField: {
        controlType: "ControlType.Document",
      },
    });
  });

  it("desktop.get_current_workspace reads live Cursor workspace", async () => {
    getForegroundWindow.mockResolvedValue({
      hwnd: 77,
      processName: "Cursor",
      windowTitle: "socketStore.ts - projectRipple - Cursor",
    });
    const tool = getRegisteredTool("desktop.get_current_workspace");
    const result = await tool!.execute({} as never, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toMatchObject({
      status: "SUCCESS",
      intent: "CURRENT_WORKSPACE",
      project: "projectRipple",
      application: "Cursor",
      openedFile: "socketStore.ts",
    });
    expect(String((result.output as { location?: string }).location)).toContain(
      "projectRipple",
    );
  });

  it("desktop.close_app closes by hwnd", async () => {
    const tool = getRegisteredTool("desktop.close_app");
    const result = await tool!.execute({} as never, { hwnd: 99 });
    expect(result.ok).toBe(true);
    expect(closeWindowByHwnd).toHaveBeenCalledWith(99);
  });

  it("desktop.press_key rejects chords", async () => {
    const tool = getRegisteredTool("desktop.press_key");
    const result = await tool!.execute({} as never, { key: "^a" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("press_key:use_hotkey_for_chord");
  });

  it("desktop.hotkey rejects bare keys", async () => {
    const tool = getRegisteredTool("desktop.hotkey");
    const result = await tool!.execute({} as never, { chord: "{ENTER}" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("hotkey:need_modifier_chord");
  });

  it("isHotkeyChord distinguishes single keys and chords", () => {
    expect(isHotkeyChord("^a")).toBe(true);
    expect(isHotkeyChord("^+s")).toBe(true);
    expect(isHotkeyChord("{ENTER}")).toBe(false);
    expect(isHotkeyChord("a")).toBe(false);
  });

  it("bridges press_key and hotkey to INSERT_TEXT keys", () => {
    expect(
      insertDataFromPlanStep({
        tool: "desktop.press_key",
        args: { key: "{ENTER}" },
      }),
    ).toEqual({ keys: "{ENTER}" });
    expect(
      insertDataFromPlanStep({
        tool: "desktop.hotkey",
        args: { chord: "^a" },
      }),
    ).toEqual({ keys: "^a" });
  });

  it("validates press_key and hotkey args", () => {
    const world = stubWorld();
    const pressKey = validatePlan(
      {
        goal: "enter",
        confidence: 0.9,
        steps: [{ tool: "desktop.press_key", args: { key: "{ENTER}" } }],
        source: "L0",
      },
      world,
    );
    expect(pressKey.valid).toBe(true);

    const hotkey = validatePlan(
      {
        goal: "select all",
        confidence: 0.9,
        steps: [{ tool: "desktop.hotkey", args: { chord: "^a" } }],
        source: "L0",
      },
      world,
    );
    expect(hotkey.valid).toBe(true);

    const missing = validatePlan(
      {
        goal: "bad",
        confidence: 0.9,
        steps: [{ tool: "desktop.hotkey", args: {} }],
        source: "L0",
      },
      world,
    );
    expect(missing.valid).toBe(false);
  });
});
