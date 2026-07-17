import type { L0PlannerResult } from "./planTypes.js";
import { getCompoundParts } from "./utteranceClassifier.js";

const SUMMARIZE_SCREEN =
  /\b(?:what(?:'s| is) (?:on|visible on) (?:my |the )?screen|summarize (?:this |the |my )?(?:screen|window|page)|describe (?:this |the |my )?(?:screen|window|page)|analyze (?:my |the |this )?(?:current )?screen|explain (?:this |the |my )?(?:page|screen|window)|what (?:can|do) (?:i|you) see)\b/i;

/** Read-only code explain — must NOT fall through to backend INSERT_TEXT. */
const EXPLAIN_CODE =
  /\bexplain\s+(?:(?:this|the|my|a)\s+)?(?:code|file|function|module|class)(?:\s+(?:to\s+me|for\s+me))?(?:\s+like\s+a\s+senior(?:\s+engineer)?)?\b|\bexplain\s+(?:the\s+)?(?:file|code)\s+i\s+am\s+(?:currently\s+)?(?:working\s+on|editing)\b/i;

const EXTRACT_CONTEXT =
  /\b(?:extract (?:my |the )?context|what context am i in|current context)\b/i;

/** Includes NLU mis-normalize "Find X on screen" → "Open my X on screen". */
const DETECT_ELEMENT =
  /\b(?:find|detect|locate|open(?:\s+my)?)\b[\s\w'-]{0,56}?\b(?:button|field|label|element|elements)\b[\s\w'-]{0,24}?\b(?:on|in)\s+(?:the |this )?(?:screen|page|window)\b|\b(?:find|detect|locate)\b[\s\w'-]{0,48}?\b(?:button|field|label|element|elements|on (?:the |this )?screen|in (?:the |this )?screen)\b/i;

const REASON_TASK =
  /\b(?:what should i do(?: next)?|reason about|how (?:do|should) i)\b/i;

const GENERATE_PLAN =
  /\b(?:make|generate|create)\b[\s\w'-]{0,20}?\b(?:action )?plan\b|\bplan (?:how|to)\b/i;

function detectQuery(text: string): string | null {
  const m =
    text.match(
      /\b(?:find|detect|locate|open(?:\s+my)?)\s+(?:the\s+)?(.+?)(?:\s+(?:on|in)\s+(?:the\s+|this\s+)?(?:screen|page|window))\s*$/i,
    ) ??
    text.match(
      /\b(?:find|detect|locate)\s+(?:the\s+)?(.+?)(?:\s+on\s+(?:the\s+)?screen)?$/i,
    ) ??
    text.match(/\b(?:find|detect|locate)\s+(.+)/i);
  const q = m?.[1]?.trim().replace(/^my\s+/i, "");
  return q && q.length >= 2 ? q.slice(0, 80) : null;
}

/**
 * P5.5 — route AI / context utterances to read-only or draft-only tools.
 */
export function tryL0AiPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const parts = getCompoundParts(rawCommand, normalized);
  if (parts && parts.length >= 2) return null;

  const text = rawCommand.trim();
  const nrm = normalized.trim();

  // Code explain before screen summarize so "explain this code" never hits page/screen OCR.
  if (EXPLAIN_CODE.test(text) || EXPLAIN_CODE.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Explain active editor file",
        confidence: 0.92,
        steps: [
          {
            tool: "ai.explain_active_editor_file",
            args: { style: "senior_engineer" },
            reason: "l0_ai_explain_code",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (SUMMARIZE_SCREEN.test(text) || SUMMARIZE_SCREEN.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Summarize active screen",
        confidence: 0.9,
        steps: [{ tool: "ai.summarize_screen", args: {}, reason: "l0_ai_summarize" }],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (EXTRACT_CONTEXT.test(text) || EXTRACT_CONTEXT.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Extract execution context",
        confidence: 0.9,
        steps: [
          {
            tool: "ai.extract_context",
            args: { includeScreen: true },
            reason: "l0_ai_context",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (DETECT_ELEMENT.test(text) || DETECT_ELEMENT.test(nrm)) {
    const query = detectQuery(text) ?? detectQuery(nrm) ?? "button";
    return {
      kind: "plan",
      plan: {
        goal: `Detect UI element: ${query}`,
        confidence: 0.85,
        steps: [
          {
            tool: "ai.detect_element",
            args: { query },
            reason: "l0_ai_detect",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (GENERATE_PLAN.test(text) || GENERATE_PLAN.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Draft action plan",
        confidence: 0.88,
        steps: [
          {
            tool: "ai.generate_action_plan",
            args: { goal: text, utterance: text },
            reason: "l0_ai_generate_plan",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (REASON_TASK.test(text) || REASON_TASK.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Reason about task",
        confidence: 0.86,
        steps: [
          {
            tool: "ai.reason_about_task",
            args: { goal: text },
            reason: "l0_ai_reason",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  return null;
}
