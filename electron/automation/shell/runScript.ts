import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { runShellCommand } from "./runCommand.js";

const ALLOWED_SCRIPT_EXTENSIONS = new Set([".ps1", ".bat", ".cmd", ".sh"]);

export function isAllowedScriptPath(scriptPath: string): boolean {
  const ext = extname(scriptPath).toLowerCase();
  return ALLOWED_SCRIPT_EXTENSIONS.has(ext);
}

export async function runScriptFile(
  scriptPath: string,
  opts?: { cwd?: string; args?: string },
): Promise<string> {
  const resolved = resolve(scriptPath.trim());
  if (!existsSync(resolved)) {
    throw new Error("script_not_found");
  }
  if (!isAllowedScriptPath(resolved)) {
    throw new Error("script_extension_not_allowed");
  }

  const ext = extname(resolved).toLowerCase();
  let command: string;
  if (ext === ".ps1") {
    command = `& ${JSON.stringify(resolved)}`;
    if (opts?.args?.trim()) command += ` ${opts.args.trim()}`;
  } else if (ext === ".sh") {
    command = `bash ${JSON.stringify(resolved)}`;
    if (opts?.args?.trim()) command += ` ${opts.args.trim()}`;
  } else {
    command = `& ${JSON.stringify(resolved)}`;
    if (opts?.args?.trim()) command += ` ${opts.args.trim()}`;
  }

  const result = await runShellCommand(command, { cwd: opts?.cwd });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "script_failed");
  }
  return result.output || `script OK: ${resolved}`;
}
