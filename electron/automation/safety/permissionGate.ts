import type { CommandResultPayload } from "../types.js";
import { permissionForCommand } from "./permissionEngine.js";
import { recordCommandEvent } from "../../telemetry/commandTelemetry.js";

export class PermissionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionBlockedError";
  }
}

/** Pull spoken command text embedded in workflow step data. */
export function commandTextFromPayload(
  payload: CommandResultPayload,
  fallback = "",
): string {
  const steps = payload.actions?.[0]?.data?.steps;
  if (!Array.isArray(steps)) return fallback;
  for (const step of steps) {
    const data = step?.data as Record<string, unknown> | undefined;
    const cmd = data?.command;
    if (typeof cmd === "string" && cmd.trim()) return cmd.trim();
  }
  return fallback;
}

/**
 * P4.6 — policy gate before Safety / Executor.
 * Throws PermissionBlockedError when command must not run.
 */
export function enforceCommandPermission(
  payload: CommandResultPayload,
  fallbackCommand = "",
): void {
  const command = commandTextFromPayload(payload, fallbackCommand);
  const perm = permissionForCommand(command, payload);
  if (perm.level !== "blocked") return;

  recordCommandEvent({
    command: command || fallbackCommand || "(unknown)",
    outcome: "blocked",
    permission: "blocked",
    detail: perm.reason,
  });
  throw new PermissionBlockedError(
    perm.reason ?? "Command blocked by policy.",
  );
}

/** Non-throwing check for orchestrator early returns. */
export function getPermissionBlockMessage(
  command: string,
  payload?: CommandResultPayload | null,
): string | null {
  const perm = permissionForCommand(command, payload);
  if (perm.level !== "blocked") return null;

  recordCommandEvent({
    command,
    outcome: "blocked",
    permission: "blocked",
    detail: perm.reason,
  });
  return perm.reason ?? "Command blocked by policy.";
}
