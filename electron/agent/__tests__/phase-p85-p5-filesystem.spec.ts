import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import { executePlan } from "../planner/toolExecutor.js";
import { validatePlan } from "../planner/planValidator.js";
import {
  ensureP85ToolsRegistered,
  planEligibleForToolExecutor,
} from "../planner/toolExecutorBridge.js";
import {
  resetPhase5FilesystemToolsForTests,
  listPhase5FilesystemToolNames,
} from "../planner/tools/filesystemTools.js";
import { setConfirmHandlerForTests } from "../../automation/safety/executionGuard.js";
import { clearUndoStack } from "../../automation/safety/undoStack.js";
import {
  readFileSafe,
  assertSafeUserPath,
  getFileMetadata,
} from "../../automation/desktop/readFileSafe.js";
import { patchFileSafe, writeFileSafe } from "../../automation/desktop/fileWrite.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/desktop/searchFiles.js", () => ({
  searchItemsByNameAsync: vi.fn(async (q: string) => [
    `C:\\Users\\me\\Projects\\${q}`,
    `C:\\Users\\me\\Downloads\\${q}.pdf`,
  ]),
}));

vi.mock("../../automation/desktop/fileOperations.js", () => ({
  deleteFile: vi.fn(async () => "Deleted"),
  createFile: vi.fn(async () => "Created file"),
  createFolder: vi.fn(async () => "Created folder"),
  renameFile: vi.fn(async () => "Renamed"),
  moveFile: vi.fn(async () => "Moved"),
}));

vi.mock("../../automation/desktop/openDesktopItem.js", () => ({
  openDesktopItem: vi.fn(async () => "Opened item"),
}));

vi.mock("../../automation/desktop/openFolder.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../automation/desktop/openFolder.js")>();
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

describe("P8.5-P5.1 filesystem intelligence", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ripple-p51-"));
    clearRegisteredToolsForTests();
    resetPhase5FilesystemToolsForTests();
    clearUndoStack();
    setConfirmHandlerForTests(async () => true);
    ensureP85ToolsRegistered();
  });

  afterEach(() => {
    clearUndoStack();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("registers P5.1 filesystem tools including search and read_file", () => {
    const names = listPhase5FilesystemToolNames();
    expect(names).toContain("filesystem.search");
    expect(names).toContain("filesystem.read_file");
    expect(names).toContain("filesystem.get_metadata");
    expect(names).toContain("filesystem.create_file");
    expect(names).toContain("filesystem.write_file");
    expect(names).toContain("filesystem.patch_file");
    expect(names).toContain("filesystem.move_file");
    expect(names.length).toBeGreaterThanOrEqual(14);
  });

  it("readFileSafe reads utf8 text", () => {
    const file = join(tempDir, "hello.txt");
    writeFileSync(file, "hello world", "utf8");
    const result = readFileSafe(file);
    expect(result.content).toBe("hello world");
    expect(result.truncated).toBe(false);
  });

  it("assertSafeUserPath blocks traversal", () => {
    expect(() => assertSafeUserPath("C:\\test\\..\\secret")).toThrow(
      /traversal/i,
    );
  });

  it("getFileMetadata returns size and type", () => {
    const file = join(tempDir, "meta.txt");
    writeFileSync(file, "x", "utf8");
    const meta = getFileMetadata(file);
    expect(meta.isFile).toBe(true);
    expect(meta.size).toBe(1);
  });

  it("executes filesystem.search through tool executor", async () => {
    const plan = {
      goal: "search",
      confidence: 0.9,
      steps: [
        {
          tool: "filesystem.search",
          args: { query: "horizon" },
        },
      ],
      rawUtterance: "find horizon",
      normalizedUtterance: "find horizon",
      source: "L0" as const,
    };
    expect(validatePlan(plan, stubWorld(), "find horizon").valid).toBe(true);
    expect(planEligibleForToolExecutor(plan)).toBe(true);
    const summary = await executePlan(plan, {
      command: "find horizon",
      world: stubWorld(),
    });
    expect(summary.ok).toBe(true);
    expect(summary.records[0]?.result.output).toMatch(/horizon/i);
  });

  it("executes filesystem.read_file through tool executor", async () => {
    const file = join(tempDir, "pkg.json");
    writeFileSync(file, '{"name":"ripple"}', "utf8");
    const plan = {
      goal: "read",
      confidence: 0.9,
      steps: [{ tool: "filesystem.read_file", args: { path: file } }],
      rawUtterance: "read package.json",
      normalizedUtterance: "read package.json",
      source: "L0" as const,
    };
    const summary = await executePlan(plan, {
      command: "read package.json",
      world: stubWorld(),
    });
    expect(summary.ok).toBe(true);
    expect(summary.records[0]?.result.output).toMatch(/ripple/);
  });

  it("write and patch files on disk", async () => {
    const file = join(tempDir, "auth.ts");
    writeFileSync(file, "export const x = 1;", "utf8");

    await writeFileSafe(file, "export const x = 2;");
    expect(readFileSafe(file).content).toContain("x = 2");

    await patchFileSafe(file, { find: "x = 2", replace: "x = 3" });
    expect(readFileSafe(file).content).toContain("x = 3");
  });

  it("validates patch_file requires patch args", () => {
    const plan = {
      goal: "patch",
      confidence: 0.9,
      steps: [{ tool: "filesystem.patch_file", args: { path: "a.ts" } }],
      rawUtterance: "patch",
      normalizedUtterance: "patch",
      source: "L0" as const,
    };
    const result = validatePlan(plan, stubWorld(), "patch");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing_arg:filesystem.patch_file.patch");
  });
});
