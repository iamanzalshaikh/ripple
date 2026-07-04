import { normalizeTranscript } from "../automation/voice/normalizeTranscript.js";
import { commandPayloadFromIntent } from "../automation/desktop/desktopCommand.js";
import { parseNativeCommandStrict } from "../automation/desktop/parseNativeCommand.js";
import type { NativeCommandIntent } from "../automation/desktop/parseNativeCommand.js";
import type { CommandResultPayload } from "../automation/types.js";
import { splitCompoundParts } from "../automation/voice/nlu/compoundParse.js";
import {
  desktopInputToTypeIntent,
  parseDesktopInputFallback,
} from "./parseDesktopInput.js";
import { buildTypingPayloadFromInput } from "./typingPayload.js";
import { isAgentGoalCommand } from "./goalDetect.js";

function normalizeCompoundPart(part: string): string {
  let p = part.trim();
  if (/^(?:type|write|put|say|likho)\b/i.test(p)) return p;
  if (/^(?:downloads?|documents?|desktop)$/i.test(p)) return `open ${p}`;
  if (/^my\s+\w/i.test(p) && !/^open\b/i.test(p)) return `open ${p}`;
  return p;
}

function parseAgentCompoundPart(part: string): NativeCommandIntent | null {
  const normalized = normalizeCompoundPart(part);
  const input = parseDesktopInputFallback(normalized);
  if (input) return desktopInputToTypeIntent(input);
  return parseNativeCommandStrict(normalized);
}

/**
 * P9 MVP — compound local commands without GPT:
 * "Open Notepad and type hello world"
 * "Launch Chrome and open Downloads"
 */
export function tryAgentCompoundCommand(
  command?: string | null,
): CommandResultPayload | null {
  const raw = normalizeTranscript(command ?? "");
  if (!raw) return null;

  const parts = splitCompoundParts(raw);
  if (!parts || parts.length < 2) return null;

  const steps: NativeCommandIntent[] = [];
  for (const part of parts) {
    const intent = parseAgentCompoundPart(part);
    if (!intent) return null;
    steps.push(intent);
  }

  return commandPayloadFromIntent(
    { kind: "compound", steps, label: "agent_compound" },
    raw,
    " (agent-compound)",
  );
}

export function tryAgentTypingFastPath(
  command?: string | null,
): CommandResultPayload | null {
  const parsed = parseDesktopInputFallback(command ?? "");
  if (!parsed) return null;
  return buildTypingPayloadFromInput(command?.trim() ?? "", parsed);
}

export function shouldTryAgentCompound(command?: string | null): boolean {
  return isAgentGoalCommand(command) || Boolean(splitCompoundParts(command ?? ""));
}
