import { randomUUID } from "node:crypto";
import { isInstagramTabActive } from "../../../focus/focusContext.js";
import { isEditOrRephraseCommand } from "../../commandIntent.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";
import type { CommandResultPayload } from "../../types.js";
import { buildInstagramCommandResult } from "./instagramCommand.js";
import {
  isContextualInstagramComposeCommand,
  isInstagramMessagingCommand,
  parseInstagramCommand,
  resolveInstagramMessageText,
} from "./parseInstagramCommand.js";

function isLocalInstagramWorkflow(result: CommandResultPayload): boolean {
  const action = result.actions?.[0];
  if (action?.type !== "WORKFLOW") return false;
  const steps = action.data?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const first = steps[0] as { data?: Record<string, unknown> };
  if (first?.data?._instagramBatch === true) return true;
  const nested = first?.data?.data as Record<string, unknown> | undefined;
  return nested?._instagramBatch === true;
}

function extractBackendText(result: CommandResultPayload): string {
  const insert = result.actions?.find((a) => a.type === "INSERT_TEXT")?.data?.text;
  if (typeof insert === "string" && insert.trim()) return insert.trim();
  if (typeof result.result === "string" && result.result.trim()) return result.result.trim();
  return "";
}

function buildInstagramComposeWorkflow(
  text: string,
  send: boolean,
  commandId?: string,
): CommandResultPayload {
  return {
    command_id: commandId ?? randomUUID(),
    intent: "workflow",
    output_type: "workflow",
    actions: [
      {
        type: "WORKFLOW",
        status: "pending",
        data: {
          steps: [
            {
              type: "NOOP",
              status: "pending",
              data: {
                _instagramBatch: true,
                instagramKind: "compose",
                text,
                send,
                pasteOnly: true,
              },
            },
          ],
        },
      },
    ],
  };
}

/** Rephrase / tone on open DM — AI text from backend → paste in composer. */
export function applyInstagramRephraseOverride(
  command: string,
  result: CommandResultPayload,
): CommandResultPayload | null {
  if (!isInstagramTabActive() || !isEditOrRephraseCommand(command)) return null;

  const text = extractBackendText(result);
  if (!text.trim()) return null;

  console.info(
    `[ripple-desktop] DM rephrase — paste ${text.length} chars (backend intent=${result.intent})`,
  );

  return buildInstagramComposeWorkflow(text, false, result.command_id);
}

/** Backend missed Instagram DM — desktop runs via extension or keyboard paste. */
export function applyInstagramVoiceOverride(
  command: string,
  result: CommandResultPayload,
): CommandResultPayload | null {
  if (isLocalInstagramWorkflow(result)) return null;

  const rephrase = applyInstagramRephraseOverride(command, result);
  if (rephrase) return rephrase;

  const cmd = normalizeTranscript(command);
  const contextual = isContextualInstagramComposeCommand(cmd);
  const structured = isInstagramMessagingCommand(cmd) && !contextual;

  if (!contextual && !structured) return null;

  const intent = parseInstagramCommand(cmd);
  if (!intent) return null;

  const insertText =
    result.actions?.find((a) => a.type === "INSERT_TEXT")?.data?.text;
  const backendText = typeof insertText === "string" ? insertText.trim() : "";
  const message = resolveInstagramMessageText(cmd, backendText);
  if (!message.trim()) return null;

  const onlySuggestions =
    result.actions?.length === 1 &&
    result.actions[0]?.type === "SHOW_SUGGESTIONS";

  const notWorkflow =
    result.intent !== "workflow" ||
    !result.actions?.some((a) => a.type === "WORKFLOW");

  const shouldOverride =
    contextual ||
    onlySuggestions ||
    notWorkflow ||
    result.intent === "generation" ||
    result.intent === "undo" ||
    result.actions?.some((a) => a.type === "INSERT_TEXT");

  if (!shouldOverride) return null;

  const local = buildInstagramCommandResult(cmd);
  if (!local) return null;

  const action = local.actions?.[0];
  const steps = action?.data?.steps as Array<{ data?: Record<string, unknown> }> | undefined;
  const batch = steps?.[0]?.data;
  if (batch) {
    batch.text = message;
    if (intent.kind === "message") {
      batch.send = intent.send;
      batch.username = intent.username;
    } else if (intent.kind === "compose") {
      batch.send = intent.send;
      batch.pasteOnly = true;
      batch.instagramKind = "compose";
    }
  }

  console.info(
    `[ripple-desktop] DM voice override — ${intent.kind}${intent.kind === "message" ? ` user="${intent.username}"` : ""} (backend intent=${result.intent})`,
  );

  return local;
}
