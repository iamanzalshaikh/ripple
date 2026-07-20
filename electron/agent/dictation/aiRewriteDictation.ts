import { API_BASE } from "../../services/api.js";
import { getAccessToken } from "../../auth/tokenStore.js";
import type {
  CorrectionDecision,
  DictationGeneration,
  SignalKind,
} from "./dictationCorrectionTypes.js";

export type AiRewriteDictationContext = {
  /** Optional previous confirmed sentence for cross-turn revisions. */
  previousText?: string;
  surface?: "whatsapp" | "gmail" | "dictation" | string;
};

/**
 * Env gate for the Wispr-style LLM cleanup layer.
 * Default ON. Set RIPPLE_P85_DICTATION_AI_REWRITE=0 to force heuristics-only.
 */
export function isDictationAiRewriteEnabled(): boolean {
  return process.env.RIPPLE_P85_DICTATION_AI_REWRITE !== "0";
}

async function authenticatedPost<T>(
  path: string,
  payload: unknown,
): Promise<T | null> {
  if (!isDictationAiRewriteEnabled()) return null;
  let accessToken: string | null = null;
  try {
    accessToken = await getAccessToken();
  } catch {
    return null;
  }
  if (!accessToken) return null;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const body = (await response.json()) as {
      success?: boolean;
      data?: T;
      message?: string;
    };
    if (!response.ok || !body.success || !body.data) {
      console.warn(
        `[ripple-dictation] ${path} failed: ${body.message ?? response.status}`,
      );
      return null;
    }
    return body.data;
  } catch (error: unknown) {
    console.warn(
      `[ripple-dictation] ${path} error:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeDictationCorrection(input: {
  committedBuffer: string;
  currentUtterance: string;
  lastSentence?: string;
  cursorPosition?: number | null;
  signalHint: SignalKind;
}): Promise<{ decision: CorrectionDecision; model?: string } | null> {
  return authenticatedPost("/voice/dictation/analyze", input);
}

export async function generateDictationCorrection(input: {
  originalText: string;
  instruction: string;
}): Promise<{ generation: DictationGeneration; model?: string } | null> {
  return authenticatedPost("/voice/dictation/generate", input);
}

/**
 * Call backend `/voice/rewrite` with mode=dictation_clean.
 * Fail-open: returns null on auth/network/API errors so callers keep heuristics.
 */
export async function aiRewriteDictation(
  raw: string,
  context?: AiRewriteDictationContext,
): Promise<string | null> {
  const text = raw.trim();
  if (!text) return null;
  if (!isDictationAiRewriteEnabled()) return null;

  let accessToken: string | null = null;
  try {
    accessToken = await getAccessToken();
  } catch {
    return null;
  }
  if (!accessToken) {
    console.info(
      "[ripple-dictation] ai_rewrite skipped — not authenticated",
    );
    return null;
  }

  const payloadText = context?.previousText?.trim()
    ? `Previous message:\n${context.previousText.trim()}\n\nNew speech:\n${text}`
    : text;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    const res = await fetch(`${API_BASE}/voice/rewrite`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: payloadText,
        mode: "dictation_clean",
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);

    const body = (await res.json()) as {
      success?: boolean;
      data?: { processed_text?: string; mode?: string };
      message?: string;
    };

    const cleaned = body.data?.processed_text?.trim();
    if (!res.ok || !body.success || !cleaned) {
      console.warn(
        `[ripple-dictation] ai_rewrite failed: ${body.message ?? res.status}`,
      );
      return null;
    }

    console.info(
      `[ripple-dictation] ai_rewrite ok surface=${context?.surface ?? "unknown"} ` +
        `in=${text.length} out=${cleaned.length}`,
    );
    return cleaned;
  } catch (e: unknown) {
    console.warn(
      "[ripple-dictation] ai_rewrite error:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
