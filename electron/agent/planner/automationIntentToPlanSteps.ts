import type { PlanStep } from "./planTypes.js";
import type { AutomationClauseIntent } from "./parseAutomationClause.js";

export function automationIntentToPlanSteps(
  intent: AutomationClauseIntent,
): PlanStep[] {
  switch (intent.kind) {
    case "open_project": {
      const args: Record<string, unknown> = {};
      if (intent.path) args.path = intent.path;
      if (intent.projectHint) args.projectHint = intent.projectHint;
      return [
        {
          tool: "automation.open_project",
          args,
          reason: "open_project",
        },
      ];
    }
    case "analyze_codebase":
      return [
        {
          tool: "automation.scan_project",
          args: { projectRoot: intent.projectRoot ?? "." },
          reason: "analyze_scan",
        },
        {
          tool: "automation.analyze_codebase",
          args: { projectRoot: intent.projectRoot ?? "." },
          reason: "analyze_codebase",
        },
        {
          tool: "automation.typecheck",
          args: { projectRoot: intent.projectRoot ?? "." },
          reason: "analyze_typecheck",
        },
      ];
    case "typecheck":
      return [
        {
          tool: "automation.typecheck",
          args: { projectRoot: intent.projectRoot ?? "." },
          reason: "typecheck",
        },
      ];
    case "lint":
      return [
        {
          tool: "automation.lint",
          args: { projectRoot: intent.projectRoot ?? "." },
          reason: "lint",
        },
      ];
    case "find_code":
      return [
        {
          tool: "automation.find_code",
          args: {
            query: intent.query,
            projectRoot: intent.projectRoot ?? ".",
          },
          reason: "find_code",
        },
      ];
    case "inspect_files":
      return [
        {
          tool: "filesystem.search",
          args: { query: intent.query ?? "error bug fix", name: intent.query ?? "error" },
          reason: "inspect_files",
        },
      ];
    case "explain_issue":
      return [
        {
          tool: "automation.find_code",
          args: { query: "error bug root cause", projectRoot: "." },
          reason: "explain_find",
        },
      ];
    case "apply_fixes":
      // A safe patch requires a concrete affected path + find/replace/content.
      // Keep this recognized but unresolved until analysis provides those args.
      return [];
    case "run_tests":
      return [
        {
          tool: "automation.run_tests",
          args: { projectRoot: intent.projectRoot ?? "." },
          reason: "run_tests",
        },
      ];
    case "git_status":
      return [
        {
          tool: "automation.git_operation",
          args: { operation: "status", cwd: intent.projectRoot ?? "." },
          reason: "git_status",
        },
      ];
    case "git_diff":
      return [
        {
          tool: "automation.git_operation",
          args: { operation: "diff", cwd: intent.projectRoot ?? "." },
          reason: "git_diff",
        },
      ];
    case "run_command":
      return [
        {
          tool: "automation.run_command",
          args: { command: intent.command },
          reason: "run_command",
        },
      ];
    case "open_terminal":
      return [
        { tool: "automation.open_terminal", args: {}, reason: "open_terminal" },
      ];
    case "run_script":
      return [
        {
          tool: "automation.run_script",
          args: { scriptPath: intent.scriptPath ?? "build.ps1" },
          reason: "run_script",
        },
      ];
    default:
      return [];
  }
}
