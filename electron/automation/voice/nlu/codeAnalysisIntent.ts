/**
 * Developer / Semantic analysis phrases — must not be rewritten to "open my …" by NLU.
 */

export const CODE_ANALYSIS_INTENT =
  /\b(?:find|identify|analyze|analyse|inspect|scan|debug|review|check)\b[\s\S]*\b(?:code|codebase|issues?|errors?|bugs?|problems?|broken)\b/i;

export const CODE_ANALYSIS_TAIL =
  /\b(?:any\s+)?(?:existing\s+)?(?:code\s+)?(?:issues?|errors?|bugs?|problems?)\b/i;

/** "find potential bug in my current code" and similar. */
export const CODE_BUG_IN_CURRENT =
  /\b(?:find|check|scan|review|locate)\b[\s\S]{0,48}?\b(?:bugs?|errors?|issues?)\b[\s\S]{0,32}?\b(?:current\s+)?(?:code|project|repo|codebase)\b/i;

/** Semantic Intent–protected phrases (requirements / security / deps / roadmap / compare). */
export const SEMANTIC_ANALYSIS_PROTECTED =
  /\b(?:missing\s+)?requirements?\b|\brequirements?\s+gap\b|\bsecurity\s+review\b|\b(?:outdated|risky)\s+dependenc|\bdependenc(?:y|ies)\b|\broadmap\b|\bproduction\s+standards?\b|\bindustry\s+standards?\b|\bnpm\s+audit\b|\bnpm\s+outdated\b/i;

export function isCodeAnalysisUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    CODE_ANALYSIS_INTENT.test(t) ||
    CODE_ANALYSIS_TAIL.test(t) ||
    CODE_BUG_IN_CURRENT.test(t) ||
    SEMANTIC_ANALYSIS_PROTECTED.test(t)
  );
}

/** Undo NLU corruption: "open my any existing code issues" → "find any existing code issues". */
export function canonicalizeCodeAnalysisPhrase(text: string): string {
  if (!isCodeAnalysisUtterance(text)) return text;
  return text
    .replace(
      /^\s*open\s+my\s+(?=any\s+existing|existing\s+code|code\s+issues?)/i,
      "find ",
    )
    .replace(
      /^\s*open\s+my\s+(?=missing\s+requirements?|requirements?)/i,
      "find ",
    )
    .replace(/^\s*open\s+my\s+all\s+/i, "find all ")
    .trim();
}
