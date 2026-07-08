import {
  isGmailVoiceCommand,
  isNewEmailCommand,
} from "../../automation/commandIntent.js";
import {
  parseEmailContent,
  sanitizeEmailAddress,
  type ParsedEmail,
} from "../../automation/emailParse.js";
import { isComposeTopicOnlyCommand } from "../parseDesktopInput.js";
import { classifyUtterance } from "./utteranceClassifier.js";
import type { ExecutionPlan, L0PlannerResult } from "./planTypes.js";

function isCompoundUtterance(command: string, normalized: string): boolean {
  return classifyUtterance(command, normalized) === "compound";
}

function skipNonAtomicGmailCompound(command: string, normalized: string): boolean {
  if (!isCompoundUtterance(command, normalized)) return false;
  if (/^\s*open\s+(?:gmail|google\s*mail)\b/i.test(command)) return false;
  if (/^\s*(?:write|send|compose|draft)\b/i.test(command)) return false;
  return true;
}

const GMAIL_URL = "https://mail.google.com/mail/u/0/";
const GMAIL_OPEN_ONLY =
  /^\s*open\s+(?:gmail|google\s*mail)\s*\.?\s*$/i;

/** True when utterance must not go through generic compound / web-search splitters. */
export function isGmailPlannerUtterance(
  command: string,
  normalized?: string,
): boolean {
  if (!isGmailVoiceCommand(command)) return false;
  if (isComposeTopicOnlyCommand(command)) return false;
  if (normalized && skipNonAtomicGmailCompound(command, normalized)) return false;
  return true;
}

function isGmailOpenOnly(command: string): boolean {
  return GMAIL_OPEN_ONLY.test(command.trim());
}

function parseGmailComposeFields(command: string): ParsedEmail {
  const parsed = parseEmailContent(command, { command });
  if (parsed.to) {
    parsed.to = sanitizeEmailAddress(parsed.to);
  }

  if (!parsed.subject) {
    const about = command.match(
      /\b(?:about|regarding|on the topic of)\s+(.+?)(?:\s+(?:and\s+)?(?:say(?:ing)?|with body)\b.*)?$/i,
    );
    if (about?.[1]?.trim()) {
      parsed.subject = about[1].trim();
    }
  }

  const saying = command.match(/\b(?:say(?:ing)?|with body|body)\s+(.+?)\s*$/i);
  if (saying?.[1]?.trim()) {
    parsed.body = saying[1].trim();
  } else if (
    parsed.body.trim() === command.trim() ||
    /^(?:write|send|compose|draft)\b/i.test(parsed.body.trim())
  ) {
    parsed.body = "";
  }

  return parsed;
}

function openWorkspacePlan(
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal: "Open Gmail",
    confidence: 0.93,
    steps: [
      {
        tool: "browser.open_workspace",
        args: {
          workspaceId: "gmail",
          url: GMAIL_URL,
        },
        reason: "gmail_open",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function composePlan(
  rawCommand: string,
  normalized: string,
  fields: ParsedEmail,
): ExecutionPlan {
  const to = fields.to ?? "";
  return {
    goal: to ? `Compose Gmail to ${to}` : "Compose Gmail",
    confidence: 0.91,
    steps: [
      {
        tool: "browser.gmail.compose",
        args: {
          to: fields.to ?? "",
          subject: fields.subject ?? "",
          body: fields.body ?? "",
          rawCommand: rawCommand.trim(),
        },
        reason: "gmail_compose",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

/**
 * L0 Gmail → tool executor (browser.open_workspace | browser.gmail.compose).
 * Replaces adapter_owned defer for gmail compose utterances.
 */
export function tryL0GmailPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  if (skipNonAtomicGmailCompound(rawCommand, normalized)) return null;
  if (!isGmailVoiceCommand(rawCommand)) return null;
  if (isComposeTopicOnlyCommand(rawCommand)) {
    return { kind: "defer", reason: "compose_needs_llm" };
  }

  if (isGmailOpenOnly(rawCommand)) {
    return { kind: "plan", plan: openWorkspacePlan(rawCommand, normalized) };
  }

  if (isNewEmailCommand(rawCommand)) {
    const fields = parseGmailComposeFields(rawCommand);
    return { kind: "plan", plan: composePlan(rawCommand, normalized, fields) };
  }

  if (/\b(?:gmail|google\s*mail)\b/i.test(rawCommand) && /\bopen\b/i.test(rawCommand)) {
    return { kind: "plan", plan: openWorkspacePlan(rawCommand, normalized) };
  }

  return null;
}
