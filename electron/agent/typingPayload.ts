import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../automation/types.js";
import type { DesktopInputParsed } from "./types.js";
import type { TypeTextIntent } from "../automation/desktop/parseNativeCommand.js";

export function insertTextDataFromInput(
  parsed: DesktopInputParsed,
): Record<string, unknown> {
  if (parsed.mode === "text") {
    return {
      text: parsed.text,
      replaceAll: parsed.replaceAll === true,
      prefocusKeys: parsed.prefocusKeys,
    };
  }
  if (parsed.mode === "keys") {
    return { keys: parsed.keys };
  }
  if (parsed.mode === "mouse") {
    const data: Record<string, unknown> = { mouseAction: parsed.action };
    if (parsed.deltaX !== undefined) data.deltaX = parsed.deltaX;
    if (parsed.deltaY !== undefined) data.deltaY = parsed.deltaY;
    return data;
  }
  return { sequence: parsed.sequence };
}

export function insertTextDataFromTypeIntent(
  intent: TypeTextIntent,
): Record<string, unknown> {
  if (intent.text) {
    return {
      text: intent.text,
      replaceAll: intent.replaceAll === true,
    };
  }
  if (intent.keys) return { keys: intent.keys };
  if (intent.sequence?.length) return { sequence: intent.sequence };
  return {};
}

export function buildTypingPayload(
  command: string,
  data: Record<string, unknown>,
  tag = "",
): CommandResultPayload {
  return {
    command_id: randomUUID(),
    intent: "typing",
    output_type: "action",
    actions: [
      {
        type: "INSERT_TEXT",
        status: "pending",
        data,
      },
    ],
  };
}

export function buildTypingPayloadFromInput(
  command: string,
  parsed: DesktopInputParsed,
): CommandResultPayload {
  return buildTypingPayload(command, insertTextDataFromInput(parsed), " (input)");
}

export function buildTypingPayloadFromTypeIntent(
  command: string,
  intent: TypeTextIntent,
): CommandResultPayload {
  return buildTypingPayload(
    command,
    insertTextDataFromTypeIntent(intent),
    " (type_text)",
  );
}
