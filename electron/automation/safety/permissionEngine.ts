import type { PermissionLevel } from "../tools/toolRegistry.js";
import {
  isDestructiveKind,
  permissionForDesktopKind,
} from "../tools/toolRegistry.js";
import type { CommandResultPayload } from "../types.js";
import { isEditorClearTextPhrase } from "../../agent/parseDesktopInput.js";

/** Utterance requests destructive filesystem / drive operations. */
const MUTATING_VERBS =
  /\b(?:delete|remove|format|wipe|erase|unlink|rmdir|destroy|overwrite|patch|write|move|rename|chmod)\b/i;

export type PermissionResult = {
  level: PermissionLevel;
  reason?: string;
};

const BULK_DELETE =
  /\b(?:delete|remove|hatao|hata)\s+(?:all|every|everything|each|sab(?:hi)?|sare|saare)\b/i;
const BULK_DELETE_HINGLISH =
  /\b(?:sab(?:hi)?|sare|saare)\s+[^\s]+(?:\s+[^\s]+)*\s+(?:delete|remove|hatao|hata)\b/i;
const WILDCARD_DELETE = /\b(?:delete|remove)\s+[^\s]*[*?][^\s]*\b/i;
const FORMAT_DRIVE =
  /\bformat\s+(?:[a-z]:\s*|drive\s+[a-z]:|[a-z]\s+drive)\b/i;
const KILL_ALL = /\b(?:kill|close)\s+all\b/i;
const WA_BROADCAST =
  /\b(?:message|send|text|bhej(?:o|do)?)\s+(?:to\s+)?(?:everyone|all\s+contacts?|sab(?:ko)?|har\s+kisi)\b/i;
const WA_NO_CONTACT =
  /\b(?:message|send|text|bhej(?:o|do)?)\s+(?:on\s+)?whatsapp\s*$/i;
/** True system locations — not every absolute path under C:\ (Wave 0 sandboxes
 * like C:\Ripple-Test must remain movable/copyable). */
const SYSTEM_PATH =
  /(?:[a-z]:[\\/](?:windows(?:[\\/]system32)?|program files(?:\s*\(x86\))?|programdata)\b)|\\windows\\system32\b|\bformat\b.*\bdrive\b/i;
const DESTRUCTIVE_SHELL =
  /\b(?:rm\s+-rf|rmdir\s+\/s|del\s+\/s|remove-item\s+-recurse)\b/i;
const BROADCAST_RECIPIENT = /^(?:everyone|all(?:\s+contacts?)?|sab(?:ko)?|har\s+kisi)$/i;

export function utteranceLooksDestructive(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isEditorClearTextPhrase(trimmed)) return false;
  if (
    BULK_DELETE.test(trimmed) ||
    BULK_DELETE_HINGLISH.test(trimmed) ||
    WILDCARD_DELETE.test(trimmed)
  ) {
    return true;
  }
  if (FORMAT_DRIVE.test(trimmed) || DESTRUCTIVE_SHELL.test(trimmed)) return true;
  if (KILL_ALL.test(trimmed)) return true;
  return SYSTEM_PATH.test(trimmed) && MUTATING_VERBS.test(trimmed);
}

function desktopKindsInPayload(payload: CommandResultPayload): string[] {
  const steps = payload.actions?.[0]?.data?.steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => (s?.data as Record<string, unknown> | undefined)?.desktopKind)
    .filter((k): k is string => typeof k === "string");
}

function whatsAppStepsInPayload(
  payload: CommandResultPayload,
): Array<Record<string, unknown>> {
  const steps = payload.actions?.[0]?.data?.steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => s?.data as Record<string, unknown> | undefined)
    .filter((d): d is Record<string, unknown> => Boolean(d?._whatsappBatch));
}

function whatsAppMissingRecipient(payload: CommandResultPayload): boolean {
  for (const data of whatsAppStepsInPayload(payload)) {
    const kind = data.whatsappKind;
    // "open" has no message; "replace_composer" edits text already in an open,
    // focused chat — there's no new recipient to resolve, only compose_message
    // (a real send to a named contact) needs one.
    if (kind === "open" || kind === "replace_composer") continue;

    const recipient = data.recipient;
    const send = data.send === true;
    const text = typeof data.text === "string" ? data.text.trim() : "";
    const isMessage =
      kind === "compose_message" ||
      kind === "message" ||
      send ||
      text.length > 0;

    if (!isMessage) continue;

    if (typeof recipient !== "string" || !recipient.trim()) {
      return true;
    }
    if (BROADCAST_RECIPIENT.test(recipient.trim())) {
      return true;
    }
  }
  return false;
}

function permissionFromDesktopKinds(kinds: string[]): PermissionResult | null {
  if (kinds.some((k) => isDestructiveKind(k))) {
    return { level: "confirm" };
  }
  if (kinds.some((k) => permissionForDesktopKind(k) === "confirm")) {
    return { level: "confirm", reason: "May overwrite an existing file." };
  }
  return null;
}

/** Policy gate before Safety / Executor (P4.6). */
export function permissionForCommand(
  command: string,
  payload?: CommandResultPayload | null,
): PermissionResult {
  const text = command.trim();
  const editorClear = isEditorClearTextPhrase(text);

  if (
    !editorClear &&
    (BULK_DELETE.test(text) ||
      BULK_DELETE_HINGLISH.test(text) ||
      WILDCARD_DELETE.test(text))
  ) {
    return { level: "blocked", reason: "Bulk delete is not allowed." };
  }
  if (FORMAT_DRIVE.test(text)) {
    return {
      level: "blocked",
      reason: "System or drive paths cannot be modified.",
    };
  }
  if (SYSTEM_PATH.test(text) && utteranceLooksDestructive(text)) {
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
  if (WA_NO_CONTACT.test(text)) {
    return {
      level: "blocked",
      reason: "WhatsApp needs a contact name before sending.",
    };
  }

  if (payload) {
    if (whatsAppMissingRecipient(payload)) {
      return {
        level: "blocked",
        reason: "WhatsApp needs a contact name before sending.",
      };
    }

    const kinds = desktopKindsInPayload(payload);
    const fromKinds = permissionFromDesktopKinds(kinds);
    if (fromKinds) return fromKinds;

    const steps = payload.actions?.[0]?.data?.steps;
    if (Array.isArray(steps) && steps.length > 10) {
      return { level: "confirm", reason: "Large workflow — review steps." };
    }
  }

  return { level: "allowed" };
}
