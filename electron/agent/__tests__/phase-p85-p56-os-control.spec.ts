import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compareDirectories,
  compareFiles,
  copyPathToDestination,
} from "../../automation/desktop/osControlOps.js";
import {
  clearRegisteredToolsForTests,
  executeToolForExecutor,
  getRegisteredTool,
} from "../planner/toolRegistry.js";
import {
  listPhase56OsToolNames,
  registerPhase56OsTools,
  resetPhase56OsToolsForTests,
} from "../planner/tools/osTools.js";
import {
  listPhase5FilesystemToolNames,
  registerPhase5FilesystemTools,
  resetPhase5FilesystemToolsForTests,
} from "../planner/tools/filesystemTools.js";
import { tryL0OsControlPlan } from "../planner/l0OsControlPlanner.js";
import { isKnownTool, TOOL_MANIFEST_VERSION } from "../planner/toolDefinitions.js";
import { setConfirmHandlerForTests } from "../../automation/safety/executionGuard.js";
import type { WorldModel } from "../types.js";
import type { ToolContext } from "../planner/toolTypes.js";

vi.mock("../../native/win32Bridge.js", () => ({
  listVisibleWindowsNative: vi.fn(async () => [
    {
      hwnd: 11,
      processName: "Cursor.exe",
      windowTitle: "jkf — Cursor",
      className: "Chrome_WidgetWin_1",
    },
    {
      hwnd: 12,
      processName: "chrome.exe",
      windowTitle: "Google Chrome",
      className: "Chrome_WidgetWin_1",
    },
  ]),
}));

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
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
      ocr: false,
    },
    activeGoal: null,
  };
}

function stubCtx(command: string): ToolContext {
  return {
    command,
    stepIndex: 0,
    execution: {
      world: stubWorld(),
      resolved: {},
      capabilities: {
        capturedAt: 0,
        manifestVersion: "2.2.0",
        registeredTools: [],
        native: { sendInput: true, uia: false, ocr: false, sidecarUp: false },
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
  };
}

describe("P8.5-P5.6 OS Control", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ripple-p56-"));
    clearRegisteredToolsForTests();
    resetPhase5FilesystemToolsForTests();
    resetPhase56OsToolsForTests();
    registerPhase5FilesystemTools();
    registerPhase56OsTools();
    setConfirmHandlerForTests(async () => true);
  });

  afterEach(() => {
    clearRegisteredToolsForTests();
    resetPhase5FilesystemToolsForTests();
    resetPhase56OsToolsForTests();
    setConfirmHandlerForTests(null);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers OS control tools and bumps manifest to 2.2.0", () => {
    const osNames = listPhase56OsToolNames();
    expect(osNames).toEqual([
      "os.run_as_admin",
      "os.get_app_properties",
      "os.get_running_apps",
      "window.inspect",
    ]);
    for (const name of [
      ...osNames,
      "filesystem.copy_file",
      "filesystem.copy_folder",
      "filesystem.move_folder",
      "filesystem.compare_directories",
      "filesystem.compare_files",
    ]) {
      expect(getRegisteredTool(name)).toBeDefined();
      expect(isKnownTool(name)).toBe(true);
    }
    expect(listPhase5FilesystemToolNames()).toEqual(
      expect.arrayContaining([
        "filesystem.copy_file",
        "filesystem.copy_folder",
        "filesystem.compare_directories",
      ]),
    );
    expect(TOOL_MANIFEST_VERSION).toBe("2.2.0");
  });

  it("copies files/folders and compares trees", () => {
    const left = join(tempDir, "left");
    const right = join(tempDir, "right");
    const dest = join(tempDir, "dest");
    mkdirSync(left, { recursive: true });
    mkdirSync(right, { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(left, "a.txt"), "hello");
    writeFileSync(join(left, "b.txt"), "world");
    writeFileSync(join(right, "a.txt"), "hello");
    writeFileSync(join(right, "c.txt"), "only-right");

    const copied = copyPathToDestination(join(left, "a.txt"), dest);
    expect(existsSync(copied)).toBe(true);
    expect(readFileSync(copied, "utf8")).toBe("hello");

    const folderCopy = copyPathToDestination(left, dest);
    expect(existsSync(join(folderCopy, "b.txt"))).toBe(true);

    const cmp = compareDirectories(left, right);
    expect(cmp.onlyLeft).toContain("b.txt");
    expect(cmp.onlyRight).toContain("c.txt");
    expect(cmp.sharedCount).toBe(1);

    const fileCmp = compareFiles(join(left, "a.txt"), join(right, "a.txt"));
    expect(fileCmp.sameHash).toBe(true);
  });

  it("L0 routes copy / compare / admin / running / inspect", () => {
    const copy = tryL0OsControlPlan(
      "Copy folder backups to Documents",
      "copy folder backups to documents",
    );
    expect(copy?.kind).toBe("plan");
    if (copy?.kind === "plan") {
      expect(copy.plan.steps[0]?.tool).toBe("filesystem.copy_folder");
    }

    const compare = tryL0OsControlPlan(
      "Compare folders left and right",
      "compare folders left and right",
    );
    expect(compare?.kind).toBe("plan");
    if (compare?.kind === "plan") {
      expect(compare.plan.steps[0]?.tool).toBe(
        "filesystem.compare_directories",
      );
    }

    const admin = tryL0OsControlPlan(
      "Run powershell as admin",
      "run powershell as admin",
    );
    expect(admin?.kind).toBe("plan");
    if (admin?.kind === "plan") {
      expect(admin.plan.steps[0]?.tool).toBe("os.run_as_admin");
    }

    const running = tryL0OsControlPlan(
      "What apps are running",
      "what apps are running",
    );
    expect(running?.kind).toBe("plan");
    if (running?.kind === "plan") {
      expect(running.plan.steps[0]?.tool).toBe("os.get_running_apps");
    }

    const inspect = tryL0OsControlPlan(
      "Inspect Cursor window",
      "inspect cursor window",
    );
    expect(inspect?.kind).toBe("plan");
    if (inspect?.kind === "plan") {
      expect(inspect.plan.steps[0]?.tool).toBe("window.inspect");
    }
  });

  it("executes get_running_apps and window.inspect via mocks", async () => {
    const running = await executeToolForExecutor(
      "os.get_running_apps",
      stubCtx("what apps are running"),
      { limit: 10 },
    );
    expect(running.ok).toBe(true);
    expect(String(running.output)).toMatch(/Cursor\.exe/i);

    const inspected = await executeToolForExecutor(
      "window.inspect",
      stubCtx("inspect cursor"),
      { query: "cursor" },
    );
    expect(inspected.ok).toBe(true);
    expect(String(inspected.output)).toMatch(/jkf/i);
  });

  it("compares directories through the tool", async () => {
    const left = join(tempDir, "tool-left");
    const right = join(tempDir, "tool-right");
    mkdirSync(left, { recursive: true });
    mkdirSync(right, { recursive: true });
    writeFileSync(join(left, "x.txt"), "1");
    writeFileSync(join(right, "y.txt"), "2");

    const result = await executeToolForExecutor(
      "filesystem.compare_directories",
      stubCtx("compare"),
      { left, right },
    );
    expect(result.ok).toBe(true);
    const body = JSON.parse(String(result.output)) as {
      onlyLeft: string[];
      onlyRight: string[];
    };
    expect(body.onlyLeft).toContain("x.txt");
    expect(body.onlyRight).toContain("y.txt");
  });
});
