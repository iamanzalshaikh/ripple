import { preprocessForNlu } from "../../automation/voice/nlu/preprocess.js";
import {
  isSendItemToContactCommand,
  parseSendItemToContactCompound,
} from "../../automation/voice/nlu/compoundParse.js";
import type { ExecutionPlan, L0PlannerResult } from "./planTypes.js";

/** Utterances like "Send Phase 3.5 PDF from downloads to Dr. Fatima on WhatsApp". */
export function isSendItemPlannerUtterance(command: string): boolean {
  return isSendItemToContactCommand(command);
}

/**
 * L0 compound — open named item in a parent folder, then WhatsApp referential send.
 * Replaces legacy desktop WORKFLOW + grounded_clarify loop for send-item phrases.
 */
export function tryL0SendItemToContactPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  if (!isSendItemToContactCommand(rawCommand)) return null;
  // Keep generic "send this to Ahmed" for ambiguity clarify path.
  if (
    !/\b(?:on|via)\s+whatsapp\b/i.test(rawCommand) &&
    !/\bfrom\s+(?:my\s+)?(?:downloads?|documents?|desktop)\b/i.test(rawCommand)
  ) {
    return null;
  }

  const { nlu } = preprocessForNlu(rawCommand);
  const compound = parseSendItemToContactCompound(nlu);
  if (!compound || compound.steps.length < 2) return null;

  const openStep = compound.steps[0];
  const sendStep = compound.steps[1];
  if (openStep?.kind !== "item" || sendStep?.kind !== "referential_send") {
    return null;
  }

  const contact = sendStep.contact?.trim();
  if (!contact) return { kind: "defer", reason: "no_contact" };

  const plan: ExecutionPlan = {
    goal: compound.label,
    confidence: 0.92,
    steps: [
      {
        tool: "filesystem.open",
        args: {
          itemName: openStep.name,
          parentFolder: openStep.parent,
        },
        reason: "send_item_open",
      },
      {
        tool: "browser.whatsapp.send",
        args: {
          contact,
          mode: "referential_send",
          referentialMode: sendStep.mode,
          send: sendStep.mode === "send_file",
          rawCommand: rawCommand.trim(),
        },
        reason: "send_item_whatsapp",
        dependsOnTools: ["filesystem.open"],
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };

  return { kind: "plan", plan };
}
