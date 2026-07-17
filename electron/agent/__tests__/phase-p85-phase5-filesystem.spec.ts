import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
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
  registerPhase2FilesystemTools,
  resetPhase2FilesystemToolsForTests,
  listPhase2FilesystemToolNames,
} from "../planner/tools/filesystemTools.js";
import {
  setConfirmHandlerForTests,
} from "../../automation/safety/executionGuard.js";
import { clearUndoStack } from "../../automation/safety/undoStack.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/desktop/fileOperations.js", () => ({
  deleteFile: vi.fn(async () => "Deleted notes.txt"),
  createFile: vi.fn(async () => "Created file"),
  createFolder: vi.fn(async () => "Created folder"),
  renameFile: vi.fn(async () => "Renamed"),
  moveFile: vi.fn(async () => "Moved"),
}));

vi.mock("../../automation/desktop/openDesktopItem.js", () => ({
  openDesktopItem: vi.fn(async () => "Opened item"),
  resolveKnownItemPath: vi.fn(() => null),
}));

vi.mock("../../automation/desktop/openFolder.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../automation/desktop/openFolder.js")>();
  return {
    ...actual,
    openFolder: vi.fn(async () => "Opened folder"),
    openFile: vi.fn(async () => "Opened file"),
  };
});

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

describe("P8.5 Phase 5 — filesystem tools", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase1DesktopToolsForTests();
    resetPhase2FilesystemToolsForTests();
    clearUndoStack();
    setConfirmHandlerForTests(async () => true);
    ensureP85ToolsRegistered();
  });

  afterEach(() => {
    clearUndoStack();
  });

  it("registers filesystem tools including P5.1 intelligence layer", () => {
    const names = listPhase2FilesystemToolNames();
    expect(names).toContain("filesystem.delete");
    expect(names).toContain("filesystem.create");
    expect(names).toContain("filesystem.search");
    expect(names).toContain("filesystem.read_file");
    expect(names).toContain("filesystem.write_file");
    expect(names).toContain("filesystem.patch_file");
    expect(names.length).toBeGreaterThanOrEqual(14);
  });

  it("validates filesystem.delete plan when tool is registered", () => {
    registerPhase2FilesystemTools();
    const plan = {
      goal: "delete file",
      confidence: 0.95,
      steps: [
        {
          tool: "filesystem.delete",
          args: { path: "notes.txt", parentFolder: "documents" },
        },
      ],
      rawUtterance: "delete notes",
      normalizedUtterance: "delete notes",
      source: "L0" as const,
    };
    const result = validatePlan(plan, stubWorld(), "delete notes");
    expect(result.valid).toBe(true);
    expect(planEligibleForToolExecutor(plan)).toBe(true);
  });

  it("executes filesystem.create through tool executor", async () => {
    const plan = {
      goal: "create file",
      confidence: 0.95,
      steps: [
        {
          tool: "filesystem.create",
          args: { fileName: "notes.txt", parentFolder: "documents" },
        },
      ],
      rawUtterance: "create notes in documents",
      normalizedUtterance: "create notes in documents",
      source: "L0" as const,
    };

    const summary = await executePlan(plan, {
      command: "create notes in documents",
      world: stubWorld(),
    });

    expect(summary.ok).toBe(true);
    expect(summary.records[0]?.tool).toBe("filesystem.create");
  });

  it("executes filesystem.delete with confirm + undo safety", async () => {
    const plan = {
      goal: "delete",
      confidence: 0.95,
      steps: [
        {
          tool: "filesystem.delete",
          args: { path: "notes.txt", parentFolder: "documents" },
        },
      ],
      rawUtterance: "delete notes.txt",
      normalizedUtterance: "delete notes.txt",
      source: "L0" as const,
    };

    const summary = await executePlan(plan, {
      command: "delete notes.txt",
      world: stubWorld(),
    });

    expect(summary.ok).toBe(true);
    expect(summary.records[0]?.tool).toBe("filesystem.delete");
  });
});
