import {
  isLikelyDesktopCommand,
  isRegionalLanguageCommand,
} from "../../automation/voice/nlu/desktopIntentGuard.js";
import { parseAliasMetaCommand } from "../../automation/desktop/parseAliasCommand.js";
import { parseSessionMemoryCommand } from "../../automation/desktop/parseSessionMemoryCommand.js";
import { parseWorkflowMetaCommand } from "../../automation/desktop/parseWorkflowCommand.js";
import { isRememberWorkflowPhrase } from "../../automation/desktop/spokenName.js";
import { normalizeTranscript } from "../../automation/voice/normalizeTranscript.js";

const GPT_FALLBACK_REASONS = new Set([
  "compose_needs_llm",
  "web_adapter_compose",
]);

const DESKTOP_OPEN_VERB =
  /^\s*(?:open|launch|start|run|switch\s+to|close|focus)\s+/i;

function isSemanticMemoryTeach(norm: string): boolean {
  return Boolean(
    parseWorkflowMetaCommand(norm) ||
      isRememberWorkflowPhrase(norm) ||
      parseSessionMemoryCommand(norm) ||
      parseAliasMetaCommand(norm),
  );
}

/** Adapter-owned commands — GPT desktop planner must not steal these. */
export function isMessagingAdapterCommand(command: string): boolean {
  const t = command.trim();
  if (!t) return false;
  if (/\b(?:instagram)\b/i.test(t) && /\b(?:post|message|send|connect)\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * P8.5 must not plan/execute these — legacy adapters own the full utterance.
 * WhatsApp, YouTube, Gmail, and LinkedIn route through dedicated L0 tool planners.
 */
export function shouldBypassP85Planner(command: string): boolean {
  const t = command.trim();
  if (!t) return false;
  if (
    /\b(?:instagram)\b/i.test(t) &&
    /\b(?:post|message|send|connect)\b/i.test(t)
  ) {
    return true;
  }
  const norm = normalizeTranscript(t);
  if (isSemanticMemoryTeach(norm)) return false;
  return false;
}

/** Utterances that should try GPT after L0 defers (human-like desktop, not adapters). */
export function isPlannerGptCandidate(command: string): boolean {
  const t = command.trim();
  if (!t || isMessagingAdapterCommand(t)) return false;
  if (isLikelyDesktopCommand(t) || isRegionalLanguageCommand(t)) return true;
  if (DESKTOP_OPEN_VERB.test(t)) return true;
  if (/^\s*(?:write|compose|draft|type|insert|put)\s+/i.test(t)) return true;
  return false;
}

export function shouldTryGptFallback(deferReason: string, command?: string): boolean {
  if (GPT_FALLBACK_REASONS.has(deferReason)) return true;
  if (process.env.RIPPLE_P85_SKIP_GPT === "1") return false;
  if (!command?.trim()) return false;
  if (deferReason === "no_l0_match" || deferReason.startsWith("validation_failed:")) {
    return isPlannerGptCandidate(command);
  }
  return false;
}
