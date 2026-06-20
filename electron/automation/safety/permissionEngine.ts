import type { PermissionLevel } from "../tools/toolRegistry.js";
import type { CommandResultPayload } from "../types.js";

export type PermissionResult = {
  level: PermissionLevel;
  reason?: string;
};

const BULK_DELETE =
  /\bdelete\s+(?:all|every|everything|each)\b/i;
const WILDCARD_DELETE = /\bdelete\s+[^\s]*[*?][^\s]*\b/i;
const FORMAT_DRIVE = /\bformat\s+(?:[a-z]:\s*|drive\s+[a-z]:|[a-z]\s+drive)\b/i;
const KILL_ALL = /\b(?:kill|close)\s+all\b/i;
const WA_BROADCAST =
  /\b(?:message|send|text|bhej(?:o|do)?)\s+(?:to\s+)?(?:everyone|all\s+contacts?|sab(?:ko)?|har\s+kisi)\b/i;
const SYSTEM_PATH =
  /\b(?:c:|d:|e:)[\\/]|\\windows\\system32\b|\bformat\b.*\bdrive\b/i;
const DESTRUCTIVE_SHELL =
  /\b(?:rm\s+-rf|rmdir\s+\/s|del\s+\/s|remove-item\s+-recurse)\b/i;

function desktopKindFromPayload(payload: CommandResultPayload): string | null {
  const steps = payload.actions?.[0]?.data?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const first = steps[0]?.data as Record<string, unknown> | undefined;
  const kind = first?.desktopKind;
  return typeof kind === "string" ? kind : null;
}

function desktopKindsInPayload(payload: CommandResultPayload): string[] {
  const steps = payload.actions?.[0]?.data?.steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => (s?.data as Record<string, unknown> | undefined)?.desktopKind)
    .filter((k): k is string => typeof k === "string");
}

/** Policy gate before Safety / Executor (P4.6). */
export function permissionForCommand(
  command: string,
  payload?: CommandResultPayload | null,
): PermissionResult {
  const text = command.trim();

  if (BULK_DELETE.test(text) || WILDCARD_DELETE.test(text)) {
    return { level: "blocked", reason: "Bulk delete is not allowed." };
  }
  if (FORMAT_DRIVE.test(text) || SYSTEM_PATH.test(text)) {
    return {
      level: "blocked",
      reason: "System or drive paths cannot be modified.",
    };
  }
  if (DESTRUCTIVE_SHELL.test(text)) {
    return { level: "blocked", reason: "Recursive shell delete is blocked." };
  }
  if (KILL_ALL.test(text)) {
    return { level: "blocked", reason: "Mass process kill is blocked." };
  }
  if (WA_BROADCAST.test(text)) {
    return { level: "blocked", reason: "Broadcast messaging is blocked." };
  }

  const kinds = payload ? desktopKindsInPayload(payload) : [];
  const kind = kinds[0] ?? (payload ? desktopKindFromPayload(payload) : null);

  if (
    kinds.some((k) => k === "delete_file" || k === "move_file" || k === "rename_file") ||
    kind === "delete_file" ||
    kind === "move_file" ||
    kind === "rename_file"
  ) {
    return { level: "confirm" };
  }
  if (kind === "create_file" || kinds.includes("create_file")) {
    return { level: "confirm", reason: "May overwrite an existing file." };
  }

  if (payload?.actions?.[0]?.data?.steps) {
    const steps = payload.actions[0].data.steps as Array<{ data?: Record<string, unknown> }>;
    if (steps.length > 10) {
      return { level: "confirm", reason: "Large workflow — review steps." };
    }
  }

  return { level: "allowed" };
}
