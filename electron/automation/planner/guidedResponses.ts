/**
 * Golden rule (§1) — every non-execute outcome must guide the user.
 * P4 — responses match user's spoken language when detectable.
 */
import {
  spokenApiUnavailable,
  spokenExamples,
  spokenMissingParent,
  spokenNotFound,
} from "../voice/i18n/spokenResponses.js";

export function guidedExamples(command?: string | null): string {
  return spokenExamples(command);
}

/** Outcome 4 — explain why not found + what to try. */
export function guidedNotFound(command: string, detail?: string): string {
  return spokenNotFound(command, detail);
}

/** When OpenAI / auth is unavailable (online-first). */
export function guidedApiUnavailable(command?: string | null): string {
  return spokenApiUnavailable(command);
}

/** When GPT returned a plan we could not map to a local tool. */
export function guidedGptMapMiss(command: string): string {
  return guidedNotFound(
    command,
    "I understood part of that but couldn't turn it into a safe desktop action. ",
  );
}

/** P1 — create/move without a location slot. */
export function guidedMissingParent(
  op: "folder" | "file" | "move" | "delete",
  command?: string | null,
): string {
  return spokenMissingParent(op, command);
}
