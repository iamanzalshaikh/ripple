import { normalizeContactToken } from "../voice/normalizeTranscript.js";
import { loadUserContactOverrides } from "./contactResolve.js";

export type ConfidenceTier = "auto" | "confirm" | "ask";

export type ContactSource = "whatsapp_session" | "override" | "transcript";

export interface ContactCandidate {
  name: string;
  confidence: number;
  source: ContactSource;
}

export interface ContactMatchResult {
  transcript: string;
  best: ContactCandidate;
  candidates: ContactCandidate[];
  tier: ConfidenceTier;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

function scorePair(transcript: string, candidate: string): number {
  const t = transcript.toLowerCase();
  const c = candidate.toLowerCase();
  if (!t || !c) return 0;
  if (t === c) return 100;
  if (c.startsWith(t) || t.startsWith(c)) return 94;
  if (c.includes(t) || t.includes(c)) return 90;

  const dist = levenshtein(t, c);
  const maxLen = Math.max(t.length, c.length, 1);
  const similarity = 1 - dist / maxLen;
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100);
}

function pickTier(best: number, second: number | undefined): ConfidenceTier {
  const gap = second === undefined ? 100 : best - second;
  if (best >= 95 && gap >= 8) return "auto";
  if (best >= 80) return "confirm";
  return "ask";
}

/**
 * Match voice name to candidates from WhatsApp session (recent/searchable chats)
 * and optional user overrides — returns confidence tier.
 */
export function matchContactWithConfidence(
  transcriptName: string,
  options?: { whatsAppSessionNames?: string[] },
): ContactMatchResult {
  const transcript = normalizeContactToken(transcriptName);
  const seen = new Set<string>();
  const candidates: ContactCandidate[] = [];

  const add = (name: string, source: ContactSource) => {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    candidates.push({
      name,
      confidence: scorePair(transcript, name),
      source,
    });
  };

  for (const n of options?.whatsAppSessionNames ?? []) {
    add(n, "whatsapp_session");
  }
  for (const n of loadUserContactOverrides()) {
    add(n, "override");
  }
  add(transcript, "transcript");

  candidates.sort((a, b) => b.confidence - a.confidence);

  const best = candidates[0] ?? {
    name: transcript,
    confidence: 40,
    source: "transcript" as const,
  };
  const second = candidates[1]?.confidence;
  let tier = pickTier(best.confidence, second);

  // Autonomous agent: a clearly-spoken name should NOT block on a modal.
  // The WhatsApp extension fuzzy-matches the real contact list itself, so we
  // only confirm when we actually have session/override candidates to weigh
  // AND the best guess is genuinely weak. A lone transcript stays auto.
  const hasKnownCandidates = candidates.some(
    (c) => c.source === "whatsapp_session" || c.source === "override",
  );
  if (!hasKnownCandidates) {
    tier = "auto";
  }
  // Unresolved pronoun/relational token reaching here means memory was empty —
  // don't silently message a fuzzy match; let the caller handle the miss.
  if (/^(?:him|her|them|he|she|my)$/i.test(transcript)) {
    tier = "ask";
  }

  console.info(
    `[ripple-desktop] contact match: "${transcript}" → "${best.name}" ${best.confidence}% tier=${tier}` +
      (candidates.length > 1
        ? ` (alt: ${candidates
            .slice(1, 4)
            .map((c) => `${c.name} ${c.confidence}%`)
            .join(", ")})`
        : ""),
  );

  return {
    transcript,
    best,
    candidates: candidates.slice(0, 5),
    tier,
  };
}

/** @deprecated Use matchContactWithConfidence */
export function resolveContactName(
  transcriptName: string,
  options?: { whatsAppContacts?: string[] },
): string {
  return matchContactWithConfidence(transcriptName, {
    whatsAppSessionNames: options?.whatsAppContacts,
  }).best.name;
}
