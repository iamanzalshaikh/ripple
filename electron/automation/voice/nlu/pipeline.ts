import type { NativeCommandIntent } from "../../desktop/parseNativeCommand.js";
import { parseNativeCommandStrict } from "../../desktop/parseNativeCommand.js";
import { parseUndoCommand } from "../../desktop/parseUndoCommand.js";
import { parseCompoundIntent, COMMA_CLAUSE_SPLIT } from "./compoundParse.js";
import { parseByIntentClassifier } from "./intentClassifier.js";
import { parseNluFallback } from "./intentExtract.js";
import { preprocessForNlu, type NluPreprocessResult } from "./preprocess.js";
import { parseSessionMemoryCommand } from "../../desktop/parseSessionMemoryCommand.js";
import { parseSmartSearchCommand } from "../../desktop/parseSmartSearchCommand.js";
import {
  parseRememberLifeEventCommand,
  type RememberLifeEventIntent,
} from "../../retriever/parseSemanticOpen.js";
import { parseGmailOpenEmailCommand } from "../../gmail/parseGmailOpenEmail.js";
import { parseOpenCrossAppAttachmentCommand } from "../../gmail/parseOpenCrossAppAttachment.js";
import { isTemporalFileOpenQuery } from "../../retriever/timeRange.js";

export type { RememberLifeEventIntent };

export type { NluPreprocessResult };
export { preprocessForNlu };

export type ParseDesktopIntentResult = {
  intent: NativeCommandIntent;
  viaNlu: boolean;
  preprocessed: NluPreprocessResult;
};

/**
 * Single entry for all Phase 4 desktop intents (open, file ops, apps, recall, etc.).
 */
export function parseDesktopIntent(
  command?: string | null,
): ParseDesktopIntentResult | null {
  const preprocessed = preprocessForNlu(command);
  if (!preprocessed.nlu) return null;

  const { nlu, raw, changed } = preprocessed;

  // P4.7 — undo before recall/compound so "wapas karo" is never misrouted.
  const undoEarly =
    parseUndoCommand(raw) ?? parseUndoCommand(nlu);
  if (undoEarly) {
    return { intent: undoEarly, viaNlu: changed, preprocessed };
  }

  const rememberLife =
    parseRememberLifeEventCommand(nlu) ?? parseRememberLifeEventCommand(raw);
  if (rememberLife) {
    return {
      intent: { kind: "remember_life_event", ...rememberLife },
      viaNlu: changed,
      preprocessed,
    };
  }

  const gmailEmail =
    parseGmailOpenEmailCommand(raw) ?? parseGmailOpenEmailCommand(nlu);
  if (gmailEmail) {
    return { intent: gmailEmail, viaNlu: changed, preprocessed };
  }

  const crossAppAttachment =
    parseOpenCrossAppAttachmentCommand(raw) ??
    parseOpenCrossAppAttachmentCommand(nlu);
  if (crossAppAttachment) {
    return { intent: crossAppAttachment, viaNlu: changed, preprocessed };
  }

  const smartSearch =
    parseSmartSearchCommand(raw) ?? parseSmartSearchCommand(nlu);
  if (smartSearch?.query.type === "semantic_topic") {
    return { intent: smartSearch, viaNlu: changed, preprocessed };
  }

  // Time-based file open — before recall:pdf ("open pdf I opened 2 months ago").
  if (
    smartSearch?.query.type === "time_ranged" ||
    (smartSearch &&
      (isTemporalFileOpenQuery(raw) || isTemporalFileOpenQuery(nlu)))
  ) {
    return { intent: smartSearch, viaNlu: changed, preprocessed };
  }

  // Multi-sentence compound should run before recall so
  // "Open last pdf... Open last folder..." does not get truncated to first recall.
  const looksMultiClause =
    /[.!?]\s+(?=(?:please\s+|kindly\s+)?(?:open|show|find|search|send|launch|start|switch|go)\b)/i.test(
      nlu,
    ) ||
    /\s+(?:and|aur|then|phir|plus|\+)\s+/i.test(nlu) ||
    COMMA_CLAUSE_SPLIT.test(nlu);
  if (looksMultiClause) {
    const compoundEarly = parseCompoundIntent(nlu, raw);
    if (compoundEarly) {
      return { intent: compoundEarly, viaNlu: true, preprocessed };
    }
  }

  // Recall before NLU filler maps can mangle "bring it back" → "open it back".
  const recallEarly =
    parseSessionMemoryCommand(raw) ?? parseSessionMemoryCommand(nlu);
  if (recallEarly) {
    return { intent: recallEarly, viaNlu: changed, preprocessed };
  }

  const compound = parseCompoundIntent(nlu, raw);
  if (compound) {
    return { intent: compound, viaNlu: true, preprocessed };
  }

  const strict = parseNativeCommandStrict(nlu);
  if (strict) {
    return { intent: strict, viaNlu: changed, preprocessed };
  }

  const fallback = parseNluFallback(nlu, raw);
  if (fallback) {
    return { intent: fallback, viaNlu: true, preprocessed };
  }

  const classified = parseByIntentClassifier(nlu);
  if (classified) {
    console.info(`[ripple-desktop] NLU classifier → ${classified.kind}`);
    return { intent: classified, viaNlu: true, preprocessed };
  }

  return null;
}

/** True if any local desktop parser understands this command. */
export function isDesktopIntent(command?: string | null): boolean {
  return parseDesktopIntent(command) !== null;
}
