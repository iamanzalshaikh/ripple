import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import { executePlan } from "../planner/toolExecutor.js";
import { INHERIT_PROJECT_ROOT } from "../planner/inheritContext.js";
import { validatePlan } from "../planner/planValidator.js";
import {
  ensureP85ToolsRegistered,
  planEligibleForToolExecutor,
} from "../planner/toolExecutorBridge.js";
import {
  listPhase5AutomationToolNames,
  resetPhase5AutomationToolsForTests,
} from "../planner/tools/automationTools.js";
import {
  isBlockedShellCommand,
  runShellCommand,
} from "../../automation/shell/runCommand.js";
import {
  findProjectRoot,
  looksLikeProjectRoot,
  resolveIdeApp,
} from "../../automation/shell/projectResolver.js";
import { setConfirmHandlerForTests } from "../../automation/safety/executionGuard.js";
import { runProjectTests } from "../../automation/shell/runTests.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/desktop/launchApp.js", () => ({
  launchNativeApp: vi.fn(async () => "Opened terminal"),
}));

vi.mock("../../automation/shell/runCommand.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../automation/shell/runCommand.js")>();
  return {
    ...actual,
    runShellCommand: vi.fn(async (command: string) => ({
      stdout: `ok:${command}`,
      stderr: "",
      exitCode: 0,
      output: `exit=0\nstdout:\nok:${command}`,
    })),
  };
});

vi.mock("../../automation/shell/runTests.js", () => ({
  detectTestRunner: vi.fn(() => "npm"),
  buildTestCommand: vi.fn(() => "npm test"),
  runProjectTests: vi.fn(async () => "exit=0\nstdout:\nall tests passed"),
}));

vi.mock("../../automation/shell/gitOperation.js", () => ({
  isAllowedGitOperation: vi.fn(() => true),
  gitOperationNeedsConfirm: vi.fn(() => true),
  runGitOperation: vi.fn(async () => "git status OK"),
}));

vi.mock("../../automation/shell/findCode.js", () => ({
  findCodeInProject: vi.fn(async () => "src/auth/login.ts:42:export function login"),
}));

vi.mock("../../automation/shell/projectResolver.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../automation/shell/projectResolver.js")>();
  const resolvedPath = "C:\\Projects\\horizon-backend";
  return {
    ...actual,
    resolveProjectPath: vi.fn(async () => resolvedPath),
    resolveProjectPathDetailed: vi.fn(async () => ({
      status: "resolved" as const,
      path: resolvedPath,
    })),
    openProjectInIde: vi.fn(async () => "Opened project in cursor: C:\\Projects\\horizon-backend"),
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

describe("P8.5-P5.4 automation tools", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ripple-p54-"));
    clearRegisteredToolsForTests();
    resetPhase5AutomationToolsForTests();
    setConfirmHandlerForTests(async () => true);
    ensureP85ToolsRegistered();
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("registers eleven automation tools", () => {
    expect(listPhase5AutomationToolNames()).toEqual([
      "automation.open_terminal",
      "automation.run_command",
      "automation.run_script",
      "automation.git_operation",
      "automation.open_project",
      "automation.find_code",
      "automation.scan_project",
      "automation.analyze_codebase",
      "automation.typecheck",
      "automation.lint",
      "automation.run_tests",
    ]);
  });

  it("blocks dangerous shell commands in validator", () => {
    expect(isBlockedShellCommand("format c:")).toBeTruthy();
    const plan = {
      goal: "bad",
      confidence: 0.5,
      steps: [
        {
          tool: "automation.run_command",
          args: { command: "format c:" },
          reason: "test",
        },
      ],
      rawUtterance: "format c:",
      normalizedUtterance: "format c:",
      source: "L0" as const,
    };
    const validation = validatePlan(plan, stubWorld(), "format c:");
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("injection"))).toBe(true);
  });

  it("detects project roots from markers", () => {
    const root = join(tempDir, "horizon-backend");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    expect(looksLikeProjectRoot(root)).toBe(true);
    expect(findProjectRoot(join(root, "src", "auth"))).toBe(root);
  });

  it("resolveIdeApp returns a registry entry without hardcoded tool strings", () => {
    const app = resolveIdeApp();
    expect(app?.id).toBeTruthy();
    expect(typeof app?.launch).toBe("string");
  });

  it("executes run_command after confirm with mocked shell", async () => {
    const plan = {
      goal: "run",
      confidence: 0.9,
      steps: [
        {
          tool: "automation.run_command",
          args: { command: "echo hello", cwd: tempDir },
          reason: "test",
        },
      ],
      rawUtterance: "run echo hello",
      normalizedUtterance: "run echo hello",
      source: "L0" as const,
    };
    expect(planEligibleForToolExecutor(plan)).toBe(true);
    const result = await executePlan(plan, {
      command: "run echo hello",
      world: stubWorld(),
      plan,
    });
    expect(result.ok).toBe(true);
    expect(runShellCommand).toHaveBeenCalled();
  });

  it("executes open_project via IDE resolver mock", async () => {
    const plan = {
      goal: "open project",
      confidence: 0.9,
      steps: [
        {
          tool: "automation.open_project",
          args: { projectHint: "horizon backend" },
          reason: "open",
        },
      ],
      rawUtterance: "open horizon backend",
      normalizedUtterance: "open horizon backend",
      source: "L0" as const,
    };
    const validation = validatePlan(plan, stubWorld(), "open horizon backend");
    expect(validation.valid).toBe(true);
    const result = await executePlan(plan, {
      command: "open horizon backend",
      world: stubWorld(),
      plan,
    });
    expect(result.ok).toBe(true);
    expect(result.records[0]?.result.output).toMatch(/cursor|project/i);
  });

  it("inherits opened project root for later test steps", async () => {
    const plan = {
      goal: "open then test",
      confidence: 0.9,
      steps: [
        {
          tool: "automation.open_project",
          args: { path: "C:\\Projects\\horizon-backend" },
          reason: "open",
        },
        {
          tool: "automation.run_tests",
          args: { projectRoot: INHERIT_PROJECT_ROOT },
          reason: "test",
        },
      ],
      rawUtterance: "open project then run tests",
      normalizedUtterance: "open project then run tests",
      source: "L0" as const,
    };

    const result = await executePlan(plan, {
      command: "open project then run tests",
      world: stubWorld(),
      plan,
    });

    expect(result.ok).toBe(true);
    expect(runProjectTests).toHaveBeenCalledWith(
      "C:\\Projects\\horizon-backend",
    );
  });

  it("inherits project root when open_project focuses an existing IDE window", async () => {
    const { openProjectInIde } = await import(
      "../../automation/shell/projectResolver.js"
    );
    vi.mocked(openProjectInIde).mockResolvedValueOnce(
      "Focused existing cursor window: C:\\Projects\\horizon-backend",
    );

    const plan = {
      goal: "open then scan",
      confidence: 0.9,
      steps: [
        {
          tool: "automation.open_project",
          args: { path: "C:\\Projects\\wrong-spoken-path" },
          reason: "open",
        },
        {
          tool: "automation.run_tests",
          args: { projectRoot: INHERIT_PROJECT_ROOT },
          reason: "test",
        },
      ],
      rawUtterance: "open then test",
      normalizedUtterance: "open then test",
      source: "L0" as const,
    };
    const result = await executePlan(plan, {
      command: "open then test",
      world: stubWorld(),
      plan,
    });
    expect(result.ok).toBe(true);
    expect(runProjectTests).toHaveBeenCalledWith(
      "C:\\Projects\\horizon-backend",
    );
  });
});
