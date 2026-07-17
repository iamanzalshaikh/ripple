import { launchNativeApp } from "../../../automation/desktop/launchApp.js";
import {
  findNativeAppById,
  resolveNativeApp,
} from "../../../automation/desktop/nativeAppRegistry.js";
import { findCodeInProject } from "../../../automation/shell/findCode.js";
import { analyzeCodebase } from "../../../automation/shell/analyzeCodebase.js";
import { scanProject } from "../../../automation/shell/scanProject.js";
import { runProjectLint } from "../../../automation/shell/runLint.js";
import { runProjectTypecheckDetailed } from "../../../automation/shell/runTypecheck.js";
import { runGitOperation } from "../../../automation/shell/gitOperation.js";
import {
  openProjectInIde,
  resolveIdeApp,
  resolveProjectPathDetailed,
} from "../../../automation/shell/projectResolver.js";
import {
  isBlockedShellCommand,
  runShellCommand,
} from "../../../automation/shell/runCommand.js";
import { runScriptFile } from "../../../automation/shell/runScript.js";
import { runProjectTests } from "../../../automation/shell/runTests.js";
import { revealCodeRepairAfterTypecheck } from "../../../automation/shell/codeRepairReveal.js";
import { recordCodeRepairDiagnostics } from "../codeRepairSession.js";
import {
  hasRegisteredTool,
  registerTool,
} from "../toolRegistry.js";
import type {
  ExecutableToolDefinition,
  RegisteredTool,
  ToolResult,
} from "../toolTypes.js";

function def(
  partial: Omit<ExecutableToolDefinition, "version" | "wave" | "since"> &
    Partial<Pick<ExecutableToolDefinition, "version" | "wave" | "since">>,
): ExecutableToolDefinition {
  return {
    version: "1.0.0",
    since: "P8.5-P5.4",
    wave: 2,
    ...partial,
  };
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function wrapAutomation(
  fn: () => Promise<string>,
): Promise<ToolResult> {
  try {
    const output = await fn();
    return { ok: true, output };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "automation_failed";
    if (message === "Cancelled") {
      return { ok: false, error: "safety_cancelled" };
    }
    return { ok: false, error: message };
  }
}

const AUTOMATION_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "automation.open_terminal",
      description: "Open Windows Terminal or shell",
      category: "automation",
      risk: "low",
      priority: 75,
      cost: 4,
      idempotent: true,
      requires: ["automation"],
      argsSchema: {
        cwd: { type: "string" },
      },
      examples: ["open terminal"],
    }),
    execute: async (_ctx, args) =>
      wrapAutomation(async () => {
        const cwd = str(args, "cwd") || undefined;
        const app =
          findNativeAppById("windows-terminal") ??
          resolveNativeApp("terminal");
        if (!app) throw new Error("terminal_not_found");
        return launchNativeApp(app, cwd ? { cwd } : undefined);
      }),
  },
  {
    definition: def({
      name: "automation.run_command",
      description: "Run a shell command in a working directory",
      category: "automation",
      risk: "high",
      priority: 60,
      cost: 12,
      idempotent: false,
      requires: ["automation"],
      argsSchema: {
        command: { type: "string", required: true },
        cwd: { type: "string" },
      },
      examples: ["run npm install in project"],
    }),
    execute: async (_ctx, args) => {
      const command = str(args, "command");
      if (!command) return { ok: false, error: "missing_arg:command" };
      if (isBlockedShellCommand(command)) {
        return { ok: false, error: "permission_blocked:command_injection" };
      }
      return wrapAutomation(async () => {
        const result = await runShellCommand(command, { cwd: str(args, "cwd") });
        if (result.exitCode !== 0) {
          throw new Error(result.output || `exit=${result.exitCode}`);
        }
        return result.output;
      });
    },
  },
  {
    definition: def({
      name: "automation.run_script",
      description: "Run an allowlisted script (.ps1, .bat, .cmd, .sh)",
      category: "automation",
      risk: "high",
      priority: 58,
      cost: 12,
      idempotent: false,
      requires: ["automation"],
      argsSchema: {
        scriptPath: { type: "string", required: true },
        cwd: { type: "string" },
        args: { type: "string" },
      },
      examples: ["run deploy.ps1"],
    }),
    execute: async (_ctx, args) => {
      const scriptPath = str(args, "scriptPath");
      if (!scriptPath) return { ok: false, error: "missing_arg:scriptPath" };
      return wrapAutomation(() =>
        runScriptFile(scriptPath, {
          cwd: str(args, "cwd") || undefined,
          args: str(args, "args") || undefined,
        }),
      );
    },
  },
  {
    definition: def({
      name: "automation.git_operation",
      description: "Run a git operation in a repository",
      category: "automation",
      risk: "high",
      priority: 62,
      cost: 10,
      idempotent: false,
      requires: ["automation"],
      argsSchema: {
        operation: { type: "string", required: true },
        cwd: { type: "string", required: true },
        message: { type: "string" },
        paths: { type: "string" },
        extraArgs: { type: "string" },
      },
      examples: ["git status in backend"],
    }),
    execute: async (_ctx, args) => {
      const operation = str(args, "operation");
      const cwd = str(args, "cwd");
      if (!operation) return { ok: false, error: "missing_arg:operation" };
      if (!cwd) return { ok: false, error: "missing_arg:cwd" };
      return wrapAutomation(() =>
        runGitOperation({
          operation,
          cwd,
          message: str(args, "message") || undefined,
          paths: str(args, "paths") || undefined,
          extraArgs: str(args, "extraArgs") || undefined,
        }),
      );
    },
  },
  {
    definition: def({
      name: "automation.open_project",
      description: "Resolve a project folder and open it in the detected IDE",
      category: "automation",
      risk: "medium",
      priority: 78,
      cost: 8,
      idempotent: true,
      requires: ["automation"],
      argsSchema: {
        projectHint: { type: "string" },
        path: { type: "string" },
      },
      examples: ["open horizon backend project"],
    }),
    execute: async (_ctx, args) =>
      wrapAutomation(async () => {
        const resolved = await resolveProjectPathDetailed({
          projectHint: str(args, "projectHint") || undefined,
          path: str(args, "path") || undefined,
        });
        if (resolved.status === "ambiguous") {
          throw new Error(`project_ambiguous:${resolved.question}`);
        }
        if (resolved.status !== "resolved") {
          throw new Error("project_not_found");
        }
        const projectPath = resolved.path;

        const ide = resolveIdeApp();
        if (ide) {
          return openProjectInIde(projectPath, ide);
        }

        const result = await runShellCommand(
          `explorer ${JSON.stringify(projectPath)}`,
        );
        if (result.exitCode !== 0) {
          throw new Error(result.stderr || "open_project_failed");
        }
        return `Opened folder: ${projectPath}`;
      }),
  },
  {
    definition: def({
      name: "automation.find_code",
      description: "Search source code in a project (ripgrep with walk fallback)",
      category: "automation",
      risk: "low",
      priority: 72,
      cost: 6,
      idempotent: true,
      requires: ["automation"],
      argsSchema: {
        query: { type: "string", required: true },
        projectRoot: { type: "string", required: true },
        extension: { type: "string" },
        maxResults: { type: "number" },
      },
      examples: ["find login handler in backend"],
    }),
    execute: async (_ctx, args) => {
      const query = str(args, "query");
      const projectRoot = str(args, "projectRoot");
      if (!query) return { ok: false, error: "missing_arg:query" };
      if (!projectRoot) return { ok: false, error: "missing_arg:projectRoot" };
      return wrapAutomation(() =>
        findCodeInProject({
          query,
          projectRoot,
          extension: str(args, "extension") || undefined,
          maxResults: num(args, "maxResults"),
        }),
      );
    },
  },
  {
    definition: def({
      name: "automation.scan_project",
      description: "Scan a project tree (priority config files + source areas)",
      category: "automation",
      risk: "low",
      priority: 71,
      cost: 5,
      idempotent: true,
      requires: ["automation"],
      argsSchema: {
        projectRoot: { type: "string", required: true },
      },
      examples: ["scan the ripple-desktop project"],
    }),
    execute: async (_ctx, args) => {
      const projectRoot = str(args, "projectRoot");
      if (!projectRoot) return { ok: false, error: "missing_arg:projectRoot" };
      return wrapAutomation(() => scanProject(projectRoot));
    },
  },
  {
    definition: def({
      name: "automation.analyze_codebase",
      description: "Read project files and report heuristic code issues",
      category: "automation",
      risk: "low",
      priority: 70,
      cost: 8,
      idempotent: true,
      requires: ["automation"],
      argsSchema: {
        projectRoot: { type: "string", required: true },
      },
      examples: ["analyze the codebase for bugs"],
    }),
    execute: async (_ctx, args) => {
      const projectRoot = str(args, "projectRoot");
      if (!projectRoot) return { ok: false, error: "missing_arg:projectRoot" };
      return wrapAutomation(() => analyzeCodebase(projectRoot));
    },
  },
  {
    definition: def({
      name: "automation.typecheck",
      description: "Run TypeScript compiler (tsc --noEmit) and report file/line errors",
      category: "automation",
      risk: "low",
      priority: 69,
      cost: 10,
      idempotent: true,
      requires: ["automation"],
      argsSchema: {
        projectRoot: { type: "string", required: true },
      },
      examples: ["run typescript typecheck in project"],
    }),
    execute: async (_ctx, args) => {
      const projectRoot = str(args, "projectRoot");
      if (!projectRoot) return { ok: false, error: "missing_arg:projectRoot" };
      return wrapAutomation(async () => {
        const detailed = await runProjectTypecheckDetailed(projectRoot);
        const repairRoot = detailed.resolvedRoot || projectRoot;
        recordCodeRepairDiagnostics(repairRoot, detailed.diagnostics);
        if (detailed.diagnostics.length > 0) {
          try {
            const panel = await revealCodeRepairAfterTypecheck(
              repairRoot,
              detailed.diagnostics,
            );
            // User already said "apply the safe fixes" → show nothing that asks again.
            // Confirm panel is only for deferred / after-confirmation flows.
            const { getPendingCodeRepair } = await import(
              "../codeRepairSession.js"
            );
            const pending = getPendingCodeRepair();
            if (panel && !pending?.autoApply) {
              const { showCodeRepairPanel } = await import(
                "../../../windows/codeRepairPanel.js"
              );
              showCodeRepairPanel(panel);
            }
          } catch (e: unknown) {
            console.warn(
              "[ripple-p85] code_repair reveal/panel failed:",
              e instanceof Error ? e.message : e,
            );
          }
        } else {
          try {
            const { hideCodeRepairPanel } = await import(
              "../../../windows/codeRepairPanel.js"
            );
            hideCodeRepairPanel();
          } catch {
            /* overlay optional in tests */
          }
        }
        return detailed.report;
      });
    },
  },
  {
    definition: def({
      name: "automation.lint",
      description: "Run ESLint and report file/line errors",
      category: "automation",
      risk: "low",
      priority: 68,
      cost: 10,
      idempotent: true,
      requires: ["automation"],
      argsSchema: {
        projectRoot: { type: "string", required: true },
      },
      examples: ["run eslint in project"],
    }),
    execute: async (_ctx, args) => {
      const projectRoot = str(args, "projectRoot");
      if (!projectRoot) return { ok: false, error: "missing_arg:projectRoot" };
      return wrapAutomation(() => runProjectLint(projectRoot));
    },
  },
  {
    definition: def({
      name: "automation.run_tests",
      description: "Run project test suite (npm/pytest/cargo)",
      category: "automation",
      risk: "high",
      priority: 55,
      cost: 14,
      idempotent: false,
      requires: ["automation"],
      argsSchema: {
        projectRoot: { type: "string", required: true },
      },
      examples: ["run tests in ripple-desktop"],
    }),
    execute: async (_ctx, args) => {
      const projectRoot = str(args, "projectRoot");
      if (!projectRoot) return { ok: false, error: "missing_arg:projectRoot" };
      return wrapAutomation(() => runProjectTests(projectRoot));
    },
  },
];

let phase5AutomationRegistered = false;

export function registerPhase5AutomationTools(): void {
  for (const tool of AUTOMATION_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  phase5AutomationRegistered = true;
}

export function listPhase5AutomationToolNames(): string[] {
  return AUTOMATION_TOOLS.map((t) => t.definition.name);
}

export function resetPhase5AutomationToolsForTests(): void {
  phase5AutomationRegistered = false;
}

export function isPhase5AutomationToolsRegistered(): boolean {
  return phase5AutomationRegistered;
}
