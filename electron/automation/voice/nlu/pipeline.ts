import type { NativeCommandIntent } from "../../desktop/parseNativeCommand.js";
import { parseNativeCommandStrict } from "../../desktop/parseNativeCommand.js";
import { parseCompoundIntent } from "./compoundParse.js";
import { parseByIntentClassifier } from "./intentClassifier.js";
import { parseNluFallback } from "./intentExtract.js";
import { preprocessForNlu, type NluPreprocessResult } from "./preprocess.js";
import { parseSessionMemoryCommand } from "../../desktop/parseSessionMemoryCommand.js";

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
