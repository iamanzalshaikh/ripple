import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** `%LOCALAPPDATA%/Ripple` on Windows, `~/.ripple` elsewhere. */
export function getRippleDataDir(): string {
  const base =
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? homedir(), "Ripple")
      : join(homedir(), ".ripple");
  mkdirSync(base, { recursive: true });
  return base;
}

export function getAliasesFilePath(): string {
  return join(getRippleDataDir(), "aliases.json");
}

export function getWorkspacesFilePath(): string {
  return join(getRippleDataDir(), "workspaces.json");
}

export function getWorkflowsFilePath(): string {
  return join(getRippleDataDir(), "workflows.json");
}

export function getContactsFilePath(): string {
  return join(getRippleDataDir(), "contacts.json");
}

export function getRippleDbPath(): string {
  return join(getRippleDataDir(), "ripple.db");
}
