import { describe, expect, it } from "vitest";
import { validatePlan, buildExecutorPayload } from "../planner/index.js";
import type { ExecutionPlan, WorldModel } from "../planner/planTypes.js";

function emptyWorld(overrides: Partial<WorldModel> = {}): WorldModel {
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
    ...overrides,
  };
}

function plan(steps: ExecutionPlan["steps"], overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    goal: "test",
    confidence: 0.95,
    steps,
    rawUtterance: "test",
    normalizedUtterance: "test",
    source: "GPT",
    ...overrides,
  };
}

describe("P8.5 plan validator", () => {
  it("rejects unknown tools (hallucinated)", () => {
    const result = validatePlan(
      plan([{ tool: "desktop.fake_tool", args: {} }]),
      emptyWorld(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("unknown_tool:desktop.fake_tool");
  });

  it("rejects missing required args", () => {
    const result = validatePlan(
      plan([{ tool: "desktop.type_text", args: {} }]),
      emptyWorld(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing_arg:desktop.type_text.text"))).toBe(true);
  });

  it("rejects empty plans", () => {
    const result = validatePlan(plan([]), emptyWorld());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("empty_plan");
  });

  it("rejects plans flagged needsClarification", () => {
    const result = validatePlan(
      plan([{ tool: "desktop.copy", args: {} }], { needsClarification: true }),
      emptyWorld(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("needs_clarification");
  });

  it("rejects paste when clipboard is empty", () => {
    const result = validatePlan(
      plan([{ tool: "desktop.paste", args: {} }]),
      emptyWorld(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("clipboard_empty"))).toBe(true);
  });

  it("allows paste after clipboard write in same compound plan", () => {
    const result = validatePlan(
      plan([
        { tool: "system.clipboard.write", args: { text: "seed" } },
        { tool: "desktop.launch_app", args: { app: "notepad" } },
        { tool: "desktop.paste", args: {} },
      ]),
      emptyWorld(),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts bridged desktop.launch_app without app arg", () => {
    const result = validatePlan(
      plan([
        {
          tool: "desktop.launch_app",
          args: { _desktopPayload: { command_id: "x", intent: "workflow", actions: [] } },
        },
      ]),
      emptyWorld(),
    );
    expect(result.valid).toBe(true);
  });

  it("blocks destructive commands via permission gate", () => {
    const result = validatePlan(
      plan([{ tool: "desktop.type_text", args: { text: "rm -rf /" } }]),
      emptyWorld(),
      "delete all files",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith("permission_blocked:"))).toBe(true);
  });

  it("buildExecutorPayload surfaces permission blocks", () => {
    const built = buildExecutorPayload(
      plan([{ tool: "desktop.type_text", args: { text: "hello" } }]),
      "format drive c",
      emptyWorld(),
    );
    expect(built.kind).toBe("invalid");
    if (built.kind !== "invalid") return;
    expect(built.errors.some((e) => e.startsWith("permission_blocked:"))).toBe(true);
  });

  it("rejects desktop.press_keys without keys or sequence", () => {
    const result = validatePlan(
      plan([{ tool: "desktop.press_keys", args: {} }]),
      emptyWorld(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("desktop.press_keys:need_keys_or_sequence");
  });

  it("allows empty write_file content for new empty files", () => {
    const result = validatePlan(
      plan([
        {
          tool: "filesystem.write_file",
          args: {
            path: "C:\\Users\\me\\Desktop\\project\\server.js",
            content: "",
          },
        },
      ]),
      emptyWorld(),
      "create file server.js in cursor",
    );
    expect(result.valid).toBe(true);
  });

  it("allows automation.open_project with a user drive path", () => {
    const result = validatePlan(
      plan([
        {
          tool: "automation.open_project",
          args: { path: "C:\\Users\\ANZAL\\Desktop\\jkf (furniture)" },
          reason: "open_project",
        },
      ]),
      emptyWorld(),
      'Open the project "C:\\Users\\ANZAL\\Desktop\\jkf (furniture)"',
    );
    expect(result.valid).toBe(true);
  });

  it("still blocks destructive drive-path utterances", () => {
    const result = validatePlan(
      plan([{ tool: "desktop.type_text", args: { text: "x" } }]),
      emptyWorld(),
      "delete C:\\Windows\\System32\\kernel32.dll",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith("permission_blocked:"))).toBe(
      true,
    );
  });
});
