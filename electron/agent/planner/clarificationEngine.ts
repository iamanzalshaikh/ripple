import type { WorldModel } from "../types.js";
import type { ExecutionPlan } from "./planTypes.js";
import { plannerConfig } from "./plannerConfig.js";
import { normalizeTranscript } from "../../automation/voice/normalizeTranscript.js";
import { splitCompoundParts } from "../../automation/voice/nlu/compoundParse.js";

export type ClarificationPending = {
  originalCommand: string;
  normalizedUtterance: string;
  question: string;
  reason: string;
  round: number;
  plan?: ExecutionPlan;
  worldHint: Pick<WorldModel, "browser" | "clipboard">;
};

let pending: ClarificationPending | null = null;

export function hasPendingClarification(): boolean {
  return pending !== null;
}

export function getPendingClarification(): ClarificationPending | null {
  return pending;
}

export function beginClarificationRound(input: {
  originalCommand: string;
  normalizedUtterance: string;
  question: string;
  reason: string;
  plan?: ExecutionPlan;
  world: WorldModel;
}): void {
  const prevRound = pending?.originalCommand === input.originalCommand
    ? pending.round
    : 0;

  pending = {
    originalCommand: input.originalCommand.trim(),
    normalizedUtterance: input.normalizedUtterance.trim(),
    question: input.question,
    reason: input.reason,
    round: prevRound + 1,
    plan: input.plan,
    worldHint: {
      browser: input.world.browser,
      clipboard: input.world.clipboard,
    },
  };
}

/**
 * If the user is answering a prior clarify prompt, merge context and return
 * an enriched command for replanning.
 */
export function resolveClarificationFollowUp(
  command: string,
): { mergedCommand: string; round: number; reason: string } | null {
  if (!pending) return null;

  const answer = command.trim();
  if (!answer) return null;

  if (pending.round > plannerConfig.clarificationMaxRounds) {
    clearClarificationContext();
    return null;
  }

  if (isClarificationRetry(answer, pending)) {
    console.info(
      `[ripple-p85] clarify retry reason=${pending.reason} (same/similar command, no merge)`,
    );
    clearClarificationContext();
    return null;
  }

  if (shouldSupersedePendingClarification(answer, pending)) {
    console.info(
      `[ripple-p85] clarify supersede reason=${pending.reason} (new command, cleared pending)`,
    );
    clearClarificationContext();
    return null;
  }

  const merged = mergeClarificationAnswer(pending, answer);
  const round = pending.round;
  const reason = pending.reason;
  pending = null;

  console.info(
    `[ripple-p85] clarify merge round=${round} reason=${reason} → "${merged.slice(0, 80)}"`,
  );

  return { mergedCommand: merged, round, reason };
}

function mergeClarificationAnswer(p: ClarificationPending, answer: string): string {
  if (p.reason === "compound_unresolved" || p.reason.startsWith("compound_")) {
    // Real clarification answers only — never substitute the old utterance.
    return `${p.originalCommand} — ${answer}`.trim();
  }
  if (p.reason === "ambiguous_recipient" || p.reason === "grounded_clarify") {
    return `${p.originalCommand} ${answer}`.trim();
  }
  if (p.reason.includes("gpt") || p.reason === "low_confidence") {
    return `${p.originalCommand} — specifically: ${answer}`.trim();
  }
  return `${p.normalizedUtterance} ${answer}`.trim();
}

/** Compare commands for clarify retry — ignore case, trailing period, extra whitespace. */
export function normalizeForClarifyCompare(command: string): string {
  return command
    .trim()
    .toLowerCase()
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Loosen wording so retries like "and" vs "," or missing "a" still match.
 * Also drops file-type / media noise words ("pdf", "file", "folder", …) and
 * "from" vs "in" so a re-statement with a minor STT wording change
 * ("Send Phase 3.5 …" vs "Send Phase 3.5 PDF …") is still detected as a retry
 * instead of being merged into a doubled command.
 */
function normalizeForClarifySimilarity(command: string): string {
  return normalizeForClarifyCompare(command)
    .replace(/,/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/\b(?:a|an|the)\b/g, " ")
    .replace(
      /\b(?:pdf|file|folder|document|doc|photo|image|picture|video|screenshot|screen\s*recording)\b/g,
      " ",
    )
    .replace(/\b(?:from|in)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0),
  );
  for (let i = 0; i < rows; i++) matrix[i]![0] = i;
  for (let j = 0; j < cols; j++) matrix[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[a.length]![b.length]!;
}

/** 0–1 similarity for retry detection (1 = same command, different phrasing). */
export function clarificationCommandSimilarity(a: string, b: string): number {
  const na = normalizeForClarifySimilarity(a);
  const nb = normalizeForClarifySimilarity(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(na, nb) / maxLen;
}

const CLARIFY_RETRY_SIMILARITY = 0.95;

/** True when the user repeated the original command instead of answering clarify. */
export function isClarificationRetry(
  incomingCommand: string,
  against: ClarificationPending,
): boolean {
  return (
    clarificationCommandSimilarity(incomingCommand, against.originalCommand) >=
      CLARIFY_RETRY_SIMILARITY ||
    clarificationCommandSimilarity(
      incomingCommand,
      against.normalizedUtterance,
    ) >= CLARIFY_RETRY_SIMILARITY
  );
}

export function isSameOrSimilarCommand(a: string, b: string): boolean {
  return clarificationCommandSimilarity(a, b) >= CLARIFY_RETRY_SIMILARITY;
}

const NEW_COMMAND_SIMILARITY_CEILING = 0.82;

/**
 * True when the user issued a fresh voice command while clarification was pending
 * (not a retry, not a short answer to the clarify prompt).
 */
export function shouldSupersedePendingClarification(
  incomingCommand: string,
  pending: ClarificationPending,
): boolean {
  const answer = incomingCommand.trim();
  if (!answer) return false;

  if (isSelfContainedDesktopCommand(answer)) {
    return true;
  }

  const similarity = Math.max(
    clarificationCommandSimilarity(answer, pending.originalCommand),
    clarificationCommandSimilarity(answer, pending.normalizedUtterance),
  );

  const transcript = normalizeTranscript(answer) || answer;
  const parts = splitCompoundParts(transcript);
  if (parts && parts.length >= 2 && similarity < NEW_COMMAND_SIMILARITY_CEILING) {
    return true;
  }

  // Short phrase = likely a clarify answer ("use the ellipse tool"), not a new command.
  if (answer.length < Math.min(48, pending.originalCommand.length * 0.75)) {
    return false;
  }

  if (similarity < 0.5 && answer.length >= 28) {
    return true;
  }

  return false;
}

export function clearClarificationContext(): void {
  pending = null;
}

/** Complete utterance — should not merge into a stale clarify prompt. */
function isSelfContainedDesktopCommand(command: string): boolean {
  const t = (normalizeTranscript(command) || command).trim();
  if (!t) return false;
  if (
    /^\s*save\b/i.test(t) &&
    /\b(?:as\s+)?[\w.-]+\.[a-z0-9]{1,6}\b/i.test(t)
  ) {
    return true;
  }
  if (/^\s*remember\s+(?:my\s+)?\w+/i.test(t) && t.length >= 18) {
    return true;
  }
  if (/^\s*(?:open|launch)\s+\w+/i.test(t) && /\b(?:and|then)\b/i.test(t)) {
    return true;
  }
  // Full "send <item> (from|in) <folder> to <contact>" restatement — a complete
  // command, never a short disambiguating answer. Merging it into a pending
  // clarify doubles the utterance and produces a garbage contact.
  if (
    /^\s*(?:send|share|whatsapp)\s+.+\s+(?:from|in)\s+(?:downloads?|documents?|desktop)\s+to\s+\S+/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function clarificationExhaustedMessage(): string {
  return "I still couldn't tell what you meant. Try saying it once more, a bit more specifically.";
}
