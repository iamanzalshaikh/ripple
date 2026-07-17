import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 12_000;

const BLOCKED_PATTERNS: RegExp[] = [
  /\bformat\b/i,
  /\bdiskpart\b/i,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sfq]/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\bremove-item\s+.+\s+-recurse\s+-force\b/i,
  /\binvoke-expression\b/i,
  /\biex\b/i,
];

export function isBlockedShellCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "empty_command";
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `blocked_command:${pattern.source}`;
    }
  }
  if (/[;&|]{2,}/.test(trimmed)) {
    return "blocked_command:chained_operators";
  }
  return null;
}

export function truncateShellOutput(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

export type ShellRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  output: string;
};

function defaultCwd(cwd?: string): string {
  const candidate = cwd?.trim();
  if (candidate && existsSync(candidate)) return candidate;
  return homedir();
}

export function runShellCommand(
  command: string,
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<ShellRunResult> {
  const blocked = isBlockedShellCommand(command);
  if (blocked) {
    return Promise.reject(new Error(blocked));
  }

  const cwd = defaultCwd(opts?.cwd);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const shellArgs =
    process.platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-Command", command]
      : ["-c", command];

  return new Promise((resolve, reject) => {
    const child = spawn(shell, shellArgs, {
      cwd,
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`command_timeout:${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_OUTPUT_CHARS * 2) {
        stdout = stdout.slice(0, MAX_OUTPUT_CHARS * 2);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_OUTPUT_CHARS) {
        stderr = stderr.slice(0, MAX_OUTPUT_CHARS);
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const exitCode = code ?? 1;
      const out = truncateShellOutput(stdout.trim());
      const err = truncateShellOutput(stderr.trim());
      const output = [
        `exit=${exitCode}`,
        out ? `stdout:\n${out}` : "",
        err ? `stderr:\n${err}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      resolve({ stdout: out, stderr: err, exitCode, output });
    });
  });
}
