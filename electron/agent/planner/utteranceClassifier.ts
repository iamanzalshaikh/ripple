import { normalizeTranscript } from "../../automation/voice/normalizeTranscript.js";
import { isCreateFileInAppCommand } from "./planCreateFileInApp.js";
import { parseFileOperationCommand } from "../../automation/desktop/parseFileOperationCommand.js";
import { parseWorkflowMetaCommand } from "../../automation/desktop/parseWorkflowCommand.js";
import { isRememberWorkflowPhrase } from "../../automation/desktop/spokenName.js";
import { splitCompoundParts, isAtomicClipboardSequence } from "../../automation/voice/nlu/compoundParse.js";
import {
  parseDesktopInputFallback,
  parseKeyboardCompoundSequence,
} from "../parseDesktopInput.js";

export type UtteranceClass = "compound" | "atomic";

/** Sticky compound gate — default on; set RIPPLE_P85_COMPOUND_STICKY=0 to restore legacy fallthrough. */
export function compoundStickyEnabled(): boolean {
  return process.env.RIPPLE_P85_COMPOUND_STICKY !== "0";
}

function normalizedForDesktopInput(normalized: string): string {
  return normalized.toLowerCase().replace(/[,\s]+/g, " ").trim();
}

/**
 * True when the full utterance is a single desktop-input action that happens
 * to contain a conjunction (keyboard compounds, clear-and-write, etc.).
 */
function isAtomicDesktopInputCompound(normalized: string): boolean {
  const n = normalizedForDesktopInput(normalized);
  if (parseKeyboardCompoundSequence(n)) return true;
  if (isAtomicClipboardSequence(n)) return true;
  if (/^select all and copy(?:\s+(?:this(?:\s+text)?|text))?$/i.test(n)) return true;
  if (/^select all and cut(?:\s+(?:this(?:\s+text)?|text|everything))?$/i.test(n)) return true;
  if (
    /^(?:delete|clear|remove)\s+all(?:\s+the)?\s+(?:text|content|everything)\s+and\s+(?:write|type|insert|put)\b/i.test(
      n,
    )
  ) {
    return true;
  }
  return false;
}

/** Single filesystem mutator — do not split on comma/and (e.g. "create folder in downloads, named X"). */
function isSingleFileOpUtterance(normalized: string): boolean {
  return parseFileOperationCommand(normalized) !== null;
}

/**
 * Classify utterance before L0 routing.
 * Compound = clause split succeeded and utterance is not a single keyboard/input action.
 */
export function classifyUtterance(
  rawCommand: string,
  normalized: string,
): UtteranceClass {
  const transcript = normalizeTranscript(rawCommand) || normalized;
  const parts = splitCompoundParts(transcript);
  if (!parts || parts.length < 2) return "atomic";

  if (isAtomicDesktopInputCompound(normalized)) return "atomic";

  if (isSingleFileOpUtterance(normalized) || isSingleFileOpUtterance(rawCommand)) {
    return "atomic";
  }

  if (
    isCreateFileInAppCommand(rawCommand) ||
    isCreateFileInAppCommand(normalized) ||
    isCreateFileInAppCommand(transcript)
  ) {
    return "atomic";
  }

  if (
    isRememberWorkflowPhrase(normalized) ||
    isRememberWorkflowPhrase(rawCommand) ||
    parseWorkflowMetaCommand(normalized) ||
    parseWorkflowMetaCommand(rawCommand)
  ) {
    return "atomic";
  }

  // Full-string typing that absorbed a comma clause (e.g. type X, save as Y) stays compound.
  const desktopInput = parseDesktopInputFallback(normalized);
  if (
    desktopInput &&
    (desktopInput.mode === "keys" ||
      desktopInput.mode === "sequence" ||
      desktopInput.mode === "mouse")
  ) {
    return "atomic";
  }

  return "compound";
}

export function getCompoundParts(
  rawCommand: string,
  normalized: string,
): string[] | null {
  const transcript = normalizeTranscript(rawCommand) || normalized;
  const parts = splitCompoundParts(transcript);
  return parts && parts.length >= 2 ? parts : null;
}
