import { existsSync } from "node:fs";
import { join } from "node:path";
import { runShellCommand, truncateShellOutput } from "./runCommand.js";

const ALLOWED_OPS = new Set([
  "status",
  "diff",
  "add",
  "commit",
  "log",
  "push",
  "pull",
  "branch",
]);

const CONFIRM_OPS = new Set(["push", "reset", "clean"]);

export function isAllowedGitOperation(op: string): boolean {
  return ALLOWED_OPS.has(op.trim().toLowerCase());
}

export function gitOperationNeedsConfirm(op: string, extraArgs?: string): boolean {
  const normalized = op.trim().toLowerCase();
  if (CONFIRM_OPS.has(normalized)) return true;
  const args = (extraArgs ?? "").toLowerCase();
  if (normalized === "reset" && args.includes("--hard")) return true;
  if (normalized === "clean" && (args.includes("-fd") || args.includes("-df"))) {
    return true;
  }
  return false;
}

export async function runGitOperation(args: {
  operation: string;
  cwd: string;
  message?: string;
  paths?: string;
  extraArgs?: string;
}): Promise<string> {
  const cwd = args.cwd.trim();
  if (!cwd || !existsSync(cwd)) {
    throw new Error("git_cwd_missing");
  }
  if (!existsSync(join(cwd, ".git"))) {
    throw new Error("not_a_git_repo");
  }

  const op = args.operation.trim().toLowerCase();
  if (!isAllowedGitOperation(op) && op !== "reset" && op !== "clean") {
    throw new Error(`git_op_not_allowed:${op}`);
  }

  let command = `git ${op}`;
  if (op === "commit") {
    const message = args.message?.trim() || "Ripple automated commit";
    command += ` -m ${JSON.stringify(message)}`;
  } else if (op === "add") {
    command += ` ${args.paths?.trim() || "."}`;
  } else if (args.extraArgs?.trim()) {
    command += ` ${args.extraArgs.trim()}`;
  }

  const result = await runShellCommand(command, { cwd });
  if (result.exitCode !== 0 && op !== "diff" && op !== "status") {
    throw new Error(result.stderr || result.stdout || `git_failed:${op}`);
  }
  return truncateShellOutput(result.output || `git ${op} OK`);
}
