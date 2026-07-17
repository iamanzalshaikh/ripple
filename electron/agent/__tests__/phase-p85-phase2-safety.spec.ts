import { describe, expect, it, beforeEach, vi } from "vitest";
import { clearRegisteredToolsForTests, registerTool } from "../planner/toolRegistry.js";
import { executePlan } from "../planner/toolExecutor.js";
import {
  checkRateLimitForTool,
  collectResolvedPaths,
  needsPermissionPass2,
  permissionPass2ForStep,
  recordRateLimitUseForTool,
  toolToRateLimitKey,
} from "../planner/toolExecutorSafety.js";
import {
  resetPhase1DesktopToolsForTests,
  registerPhase1DesktopTools,
} from "../planner/tools/desktopTools.js";
import {
  resetActionLimiterForTests,
} from "../../automation/safety/actionLimiter.js";
import {
  setConfirmHandlerForTests,
} from "../../automation/safety/executionGuard.js";
import { clearUndoStack, undoStackSize } from "../../automation/safety/undoStack.js";
import { clearPlannerMemoryForTests } from "../planner/plannerMemory.js";
import type { ExecutableToolDefinition } from "../planner/toolTypes.js";
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

const stubDef = (
  overrides: Partial<ExecutableToolDefinition> = {},
): ExecutableToolDefinition => ({
  name: "filesystem.delete",
  version: "1.0.0",
  since: "P8.5",
  description: "Delete file",
  category: "filesystem",
  wave: 2,
  risk: "high",
  argsSchema: { path: { type: "string", required: true } },
  ...overrides,
});

describe("P8.5 Phase 2 — executor safety", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase1DesktopToolsForTests();
    resetActionLimiterForTests();
    clearUndoStack();
    clearPlannerMemoryForTests();
    setConfirmHandlerForTests(null);
    vi.restoreAllMocks();
  });

  it("maps desktop tools to rate limit keys", () => {
    expect(toolToRateLimitKey("desktop.launch_app")).toBe("launch_app");
    expect(toolToRateLimitKey("desktop.type_text")).toBe("default");
  });

  it("blocks when rate limit exceeded", () => {
    for (let i = 0; i < 80; i++) {
      recordRateLimitUseForTool("desktop.type_text");
    }
    const blocked = checkRateLimitForTool("desktop.type_text");
    expect(blocked?.ok).toBe(false);
    expect(blocked?.error).toMatch(/^rate_limit:/);
  });

  it("pass 2 blocks system paths for filesystem mutators", () => {
    expect(needsPermissionPass2("filesystem.delete", { path: "C:\\test.txt" })).toBe(
      true,
    );
    expect(
      permissionPass2ForStep("filesystem.delete", {
        path: "C:\\Windows\\System32\\kernel32.dll",
      })?.error,
    ).toMatch(/permission_blocked/);
  });

  it("pass 2 blocks wildcard targets", () => {
    expect(
      permissionPass2ForStep("filesystem.delete", { path: "*.pdf" })?.error,
    ).toMatch(/Bulk delete/);
  });

  it("pass 2 skips typing-only desktop tools", () => {
    expect(needsPermissionPass2("desktop.type_text", { text: "hello" })).toBe(
      false,
    );
    expect(permissionPass2ForStep("desktop.type_text", { text: "hello" })).toBe(
      null,
    );
  });

  it("collectResolvedPaths gathers path args", () => {
    expect(
      collectResolvedPaths({
        from: "a.txt",
        to: "b.txt",
        paths: ["x.pdf", "y.pdf"],
      }),
    ).toEqual(expect.arrayContaining(["a.txt", "b.txt", "x.pdf", "y.pdf"]));
    expect(
      collectResolvedPaths({ from: "a.txt", to: "b.txt", paths: ["x.pdf", "y.pdf"] })
        .length,
    ).toBe(4);
  });

  it("confirm cancellation aborts step without execute", async () => {
    setConfirmHandlerForTests(async () => false);
    registerTool({
      definition: stubDef({ name: "filesystem.delete" }),
      execute: vi.fn(async () => ({ ok: true, output: "deleted" })),
    });

    const summary = await executePlan(
      {
        goal: "delete",
        confidence: 1,
        steps: [{ tool: "filesystem.delete", args: { path: "notes.txt" } }],
        rawUtterance: "delete notes",
        normalizedUtterance: "delete notes",
        source: "L0",
      },
      { command: "delete notes", world: stubWorld() },
    );

    expect(summary.ok).toBe(false);
    expect(summary.records[0]?.result.error).toBe("safety_cancelled");
  });

  it("skips confirm popup for pre-authorized code_repair_patch steps", async () => {
    const confirmSpy = vi.fn(async () => false);
    setConfirmHandlerForTests(confirmSpy);
    const execute = vi.fn(async () => ({ ok: true, output: "patched" }));
    registerTool({
      definition: stubDef({
        name: "filesystem.patch_file",
        risk: "high",
        category: "filesystem",
      }),
      execute,
    });

    const summary = await executePlan(
      {
        goal: "Apply safe code repairs",
        confidence: 1,
        steps: [
          {
            tool: "filesystem.patch_file",
            args: {
              path: "C:\\tmp\\broken.ts",
              find: "st",
              replace: "string",
            },
            reason: "code_repair_patch_1",
          },
        ],
        rawUtterance: "apply the safe fixes",
        normalizedUtterance: "apply the safe fixes",
        source: "L0",
      },
      { command: "apply the safe fixes", world: stubWorld() },
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
    expect(summary.ok).toBe(true);
  });

  it("pushes undo before filesystem mutator execute", async () => {
    setConfirmHandlerForTests(async () => true);
    clearUndoStack();
    const execute = vi.fn(async () => ({ ok: true, output: "deleted" }));
    registerTool({
      definition: stubDef({ name: "filesystem.delete" }),
      execute,
    });

    const sizeBefore = undoStackSize();
    await executePlan(
      {
        goal: "delete",
        confidence: 1,
        steps: [
          {
            tool: "filesystem.delete",
            args: { path: "Documents\\notes.txt" },
          },
        ],
        rawUtterance: "delete notes",
        normalizedUtterance: "delete notes",
        source: "L0",
      },
      { command: "delete notes in documents", world: stubWorld() },
    );

    expect(execute).toHaveBeenCalled();
    expect(undoStackSize()).toBe(sizeBefore + 1);
  });

  it("desktop phase 1 tools skip confirm and pass 2", async () => {
    registerPhase1DesktopTools();
    const summary = await executePlan(
      {
        goal: "copy",
        confidence: 1,
        steps: [{ tool: "desktop.copy", args: {} }],
        rawUtterance: "copy",
        normalizedUtterance: "copy",
        source: "L0",
      },
      { command: "copy", world: stubWorld() },
    );

    expect(summary.records[0]?.result.error).not.toBe("safety_cancelled");
    expect(needsPermissionPass2("desktop.copy", {})).toBe(false);
  });

  it("blocks step when dependsOnTools not satisfied", async () => {
    registerTool({
      definition: stubDef({
        name: "tool.alpha",
        dependsOnTools: ["tool.beta"],
      }),
      execute: vi.fn(async () => ({ ok: true, output: "alpha" })),
    });
    registerTool({
      definition: stubDef({ name: "tool.beta" }),
      execute: vi.fn(async () => ({ ok: true, output: "beta" })),
    });

    const summary = await executePlan(
      {
        goal: "ordered",
        confidence: 1,
        steps: [
          { tool: "tool.alpha", args: {} },
          { tool: "tool.beta", args: {} },
        ],
        rawUtterance: "ordered",
        normalizedUtterance: "ordered",
        source: "L0",
      },
      { command: "ordered", world: stubWorld() },
    );

    expect(summary.ok).toBe(false);
    expect(summary.records[0]?.result.error).toBe("depends_on_tools:tool.beta");
  });
});
