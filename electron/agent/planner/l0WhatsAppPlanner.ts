import { isWhatsAppTabActive } from "../../focus/focusContext.js";
import { getLastCommandContext } from "../../storage/lastCommandState.js";
import {
  commandImpliesSend,
  extractContactName,
  isWhatsAppMessagingCommand,
  LAST_CONTACT_MARKER,
  resolveWhatsAppContactRef,
  resolveWhatsAppMessageText,
} from "../../automation/adapters/whatsapp/parseContact.js";
import {
  isWhatsAppOpenCommand,
  parseWhatsAppCommand,
} from "../../automation/adapters/whatsapp/parseWhatsAppCommand.js";
import { isSendItemToContactCommand } from "../../automation/voice/nlu/compoundParse.js";
import { preprocessForNlu } from "../../automation/voice/nlu/preprocess.js";
import {
  parseReferentialSend,
  resolveReferentialContact,
} from "../../automation/voice/nlu/parseReferentialWhatsApp.js";
import type { ExecutionPlan, L0PlannerResult } from "./planTypes.js";

const WHATSAPP_URL = "https://web.whatsapp.com";

const AMBIGUOUS_SEND =
  /^(?:send|share)\s+(?:this|that)\s+(?:to|with)\s+/i;

/** Bare "search <name>" — no file/web keywords — while a WhatsApp chat is open. */
const BARE_SEARCH = /^\s*search\s+(?:for\s+)?(.+?)\s*$/i;
const FILE_SEARCH_KEYWORD =
  /\b(?:file|folder|resume|download|document|desktop|pdf|web|google|browser)\b/i;

function whatsAppSendImplicit(command: string): boolean {
  if (commandImpliesSend(command)) return true;
  if (/\b(?:say|ask|tell|type|writ)\w*\b/i.test(command)) return true;
  if (/^\s*(?:message|msg|text)\s+.+?\s*:\s*\S/i.test(command)) return true;
  if (/^\s*send\s+.+\s*:\s*\S/i.test(command)) return true;
  const msg = resolveWhatsAppMessageText(command, "");
  if (msg.trim() && /^\s*(?:message|send)\s+/i.test(command)) return true;
  return false;
}

/** Resolve contact for plan args — pronouns → last_contact from session memory. */
function resolvePlanContact(rawContact: string): string | null {
  if (rawContact === LAST_CONTACT_MARKER) {
    return resolveWhatsAppContactRef(
      LAST_CONTACT_MARKER,
      getLastCommandContext().last_contact,
    );
  }
  return resolveWhatsAppContactRef(
    rawContact,
    getLastCommandContext().last_contact,
  );
}

function planContactOrDefer(
  rawCommand: string,
  normalized: string,
  rawContact: string,
  message: string,
  send: boolean,
): L0PlannerResult {
  const contact = resolvePlanContact(rawContact);
  if (!contact) {
    return { kind: "defer", reason: "no_last_contact" };
  }
  return {
    kind: "plan",
    plan: sendMessagePlan(rawCommand, normalized, contact, message, send),
  };
}

/**
 * When WhatsApp is the focused tab, a bare "search <name>" means "open that
 * contact's chat" — NOT a Google web search that would navigate the WhatsApp
 * tab away. Returns the contact name, or null when it is not this case.
 */
function contextualWhatsAppSearchContact(command: string): string | null {
  if (!isWhatsAppTabActive()) return null;
  if (FILE_SEARCH_KEYWORD.test(command)) return null;
  if (/\b(?:say|ask|tell|message|type|write)\b/i.test(command)) return null;
  const m = command.match(BARE_SEARCH);
  const name = m?.[1]?.trim();
  return name ? name : null;
}

/** True when utterance must not go through generic compound / web-search splitters. */
export function isWhatsAppPlannerUtterance(command: string): boolean {
  return isWhatsAppPlannerCommand(command);
}

function isWhatsAppPlannerCommand(command: string): boolean {
  if (/\bwhats?\s*app\b/i.test(command)) return true;
  if (isWhatsAppOpenCommand(command)) return true;
  if (isWhatsAppMessagingCommand(command)) return true;
  // Context-aware: a bare "search <name>" while a WhatsApp chat is focused
  // means "open that contact's chat" — keep it in WhatsApp, not Google.
  if (contextualWhatsAppSearchContact(command)) return true;
  return false;
}

function openWorkspacePlan(
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal: "Open WhatsApp",
    confidence: 0.93,
    steps: [
      {
        tool: "browser.open_workspace",
        args: {
          workspaceId: "whatsapp",
          url: WHATSAPP_URL,
        },
        reason: "whatsapp_open",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function sendMessagePlan(
  rawCommand: string,
  normalized: string,
  contact: string,
  message: string,
  send: boolean,
): ExecutionPlan {
  return {
    goal: `WhatsApp message to ${contact}`,
    confidence: 0.92,
    steps: [
      {
        tool: "browser.whatsapp.send",
        args: {
          contact,
          message,
          send,
          mode: "message",
          rawCommand: rawCommand.trim(),
        },
        reason: "whatsapp_message",
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
  message: string,
  send: boolean,
): ExecutionPlan {
  return {
    goal: "Compose WhatsApp message",
    confidence: 0.91,
    steps: [
      {
        tool: "browser.whatsapp.send",
        args: {
          message,
          send,
          mode: "compose",
          rawCommand: rawCommand.trim(),
        },
        reason: "whatsapp_compose",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function referentialSendPlan(
  rawCommand: string,
  normalized: string,
  contact: string,
  mode: "send_file" | "message_again",
): ExecutionPlan {
  return {
    goal: `WhatsApp ${mode} to ${contact}`,
    confidence: 0.9,
    steps: [
      {
        tool: "browser.whatsapp.send",
        args: {
          contact,
          mode: "referential_send",
          referentialMode: mode,
          send: mode === "send_file",
          rawCommand: rawCommand.trim(),
        },
        reason: "whatsapp_referential",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function tryReferentialWhatsAppPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const { nlu } = preprocessForNlu(rawCommand);
  const intent = parseReferentialSend(nlu);
  if (!intent) return null;

  if (intent.mode === "send_file") {
    const ctx = getLastCommandContext();
    if (!ctx.last_file && !ctx.last_folder) return null;
  }

  const contact = resolveReferentialContact(
    intent.contact,
    getLastCommandContext().last_contact,
  );
  if (!contact) {
    return { kind: "defer", reason: "no_last_contact" };
  }

  return {
    kind: "plan",
    plan: referentialSendPlan(rawCommand, normalized, contact, intent.mode),
  };
}

/**
 * L0 WhatsApp → tool executor (browser.open_workspace | browser.whatsapp.send).
 * Replaces legacy orchestrator whatsapp-* routers and adapter_owned defer.
 */
export function tryL0WhatsAppPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  if (AMBIGUOUS_SEND.test(rawCommand.trim())) return null;

  const referential = tryReferentialWhatsAppPlan(rawCommand, normalized);
  if (referential) return referential;

  if (!isWhatsAppPlannerCommand(rawCommand)) return null;
  if (isSendItemToContactCommand(rawCommand)) return null;

  // Bare "search <name>" while WhatsApp is focused → open that contact's chat.
  // Must NOT fall through to Planner v2 WEB_SEARCH (which navigates the WhatsApp
  // tab to Google and destroys it, breaking any later send).
  const searchContact = contextualWhatsAppSearchContact(rawCommand);
  if (searchContact) {
    return planContactOrDefer(rawCommand, normalized, searchContact, "", false);
  }

  const intent = parseWhatsAppCommand(rawCommand);
  if (intent?.kind === "open") {
    return { kind: "plan", plan: openWorkspacePlan(rawCommand, normalized) };
  }
  if (intent?.kind === "message") {
    return planContactOrDefer(
      rawCommand,
      normalized,
      intent.contact,
      intent.text,
      intent.send || whatsAppSendImplicit(rawCommand),
    );
  }
  if (intent?.kind === "compose") {
    return {
      kind: "plan",
      plan: composePlan(rawCommand, normalized, intent.text, intent.send || whatsAppSendImplicit(rawCommand)),
    };
  }

  if (isWhatsAppOpenCommand(rawCommand)) {
    return { kind: "plan", plan: openWorkspacePlan(rawCommand, normalized) };
  }

  if (isWhatsAppMessagingCommand(rawCommand)) {
    const rawContact = extractContactName(rawCommand);
    if (!rawContact?.trim()) return null;
    const message = resolveWhatsAppMessageText(rawCommand, "");
    const send = whatsAppSendImplicit(rawCommand);
    return planContactOrDefer(rawCommand, normalized, rawContact, message, send);
  }

  return null;
}
