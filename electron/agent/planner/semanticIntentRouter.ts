/**
 * Semantic Intent Router — Layer-1 meaning → structured intent → tool plan.
 * Owns understanding only; planner/validator/executor still own tools & safety.
 */
import type { ExecutionPlan, L0PlannerResult, PlanStep } from "./planTypes.js";
import { INHERIT_PROJECT_ROOT } from "./inheritContext.js";
import { extractWindowsPath } from "./parseAutomationClause.js";
import { shouldBypassP85Planner } from "./gptFallbackPolicy.js";
import { isWhatsAppPlannerUtterance } from "./l0WhatsAppPlanner.js";
import { isYouTubePlannerUtterance } from "./l0YouTubePlanner.js";
import { isGmailPlannerUtterance } from "./l0GmailPlanner.js";
import { isLinkedInPlannerUtterance } from "./l0LinkedInPlanner.js";
import { isInstagramPlannerUtterance } from "./l0InstagramPlanner.js";
import { isSendItemPlannerUtterance } from "./l0SendItemPlanner.js";
import { isNotionPlannerUtterance } from "./l0NotionPlanner.js";
import { intentToSchemaId } from "../reports/reportSchemas.js";

export type SemanticIntentKind =
  | "CODE_ANALYSIS"
  | "SECURITY_REVIEW"
  | "DEPENDENCY_AUDIT"
  | "REQUIREMENTS_GAP"
  | "PROJECT_ROADMAP"
  | "COMPARE_TO_STANDARD"
  | "COMPOUND_WORKFLOW"
  | "NONE";

export type SemanticIntent = {
  intent: SemanticIntentKind;
  target: string;
  action: string;
  confidence: number;
  constraints: string[];
  notes: string;
};

export type SemanticConfidenceAction = "execute" | "confirm" | "clarify";

const SECURITY_REVIEW =
  /\b(?:security|secure|vulnerability|vulnerabilities|cve|owasp|threat)\b[\s\S]{0,48}?\b(?:review|audit|scan|check|assess)\b|\b(?:review|audit|scan|check|assess)\b[\s\S]{0,48}?\b(?:security|vulnerabilit(?:y|ies)|cve|owasp)\b|\bperform\s+a\s+security\s+review\b/i;

const DEPENDENCY_AUDIT =
  /\b(?:analy[sz]e|audit|check|review)\b[\s\S]{0,80}?\bdependenc(?:y|ies)\b|\b(?:outdated|risky)\b[\s\S]{0,48}?\bdependenc(?:y|ies)\b|\bdependenc(?:y|ies)\b[\s\S]{0,48}?\b(?:outdated|risky|audit|vulnerab)|(?:\bnpm\s+audit\b|\bnpm\s+outdated\b)/i;

const REQUIREMENTS_GAP =
  /\b(?:find|identify|list|check|detect|discover)\b[\s\S]{0,48}?\b(?:missing\s+)?requirements?\b|\bmissing\s+requirements?\b|\brequirements?\s+gap\b|\bgap\s+analy[sz]e?\b/i;

const PROJECT_ROADMAP =
  /\b(?:create|make|build|draft|write|generate)\b[\s\S]{0,40}?\broadmap\b|\broadmap\b[\s\S]{0,40}?\b(?:complete|finish|ship|project)\b/i;

const COMPARE_TO_STANDARD =
  /\bcompar(?:e|ing|ison)\b[\s\S]{0,80}?\b(?:production|industry|best[\s-]?practice|standard|standards)\b|\b(?:production|industry)\s+standards?\b/i;

const CODE_ANALYSIS =
  /\b(?:bro\s+)?(?:check|analy[sz]e|inspect|review|debug|scan)\b[\s\S]{0,48}?\b(?:my\s+|the\s+|this\s+)?(?:code|codebase|project|repo)\b|\bwhat(?:'s|\s+is)\s+wrong\s+with\s+(?:this\s+|my\s+)?code\b|\bfind\b[\s\S]{0,48}?\b(?:bugs?|errors?|issues?)\b[\s\S]{0,32}?\b(?:code|project|repo|codebase)\b/i;

const COMPOUND_NOTEPAD =
  /\b(?:check|analy[sz]e|inspect|review)\b[\s\S]{0,80}?\b(?:issue|issues|bug|bugs|error|errors|problem|problems)\b[\s\S]{0,120}?\b(?:summariz(?:e|ing)|summary)\b[\s\S]{0,120}?\b(?:note|notes|notepad)\b|\bmake\s+a\s+note\s+in\s+notepad\b/i;

const DETERMINISTIC_LOCAL =
  /^\s*(?:open|launch|start|close|quit|kill|switch\s+to|focus)\s+(?:chrome|spotify|notepad|calculator|explorer|edge|firefox|vscode|cursor)\b/i;

/** Prefer raw when NLU rewrote the leading verb (e.g. Find → Open my). */
export function preferRawForSemantic(raw: string, normalized: string): string {
  const r = raw.trim();
  const n = normalized.trim();
  if (!r) return n;
  if (!n) return r;
  const rawVerb = r.match(/^\s*(find|identify|locate|grab|check|analy[sz]e|review|compare|create|make)\b/i)?.[1];
  const nluOpen = /^\s*open\s+my\b/i.test(n);
  if (rawVerb && nluOpen && !/^\s*open\b/i.test(r)) {
    return r;
  }
  // If NLU changed an analysis verb to open, prefer raw.
  if (
    nluOpen &&
    /\b(?:missing\s+requirements?|security|dependenc|roadmap|production\s+standards?)\b/i.test(
      r,
    )
  ) {
    return r;
  }
  return n.length >= r.length * 0.5 ? n : r;
}

export function applySemanticConfidenceGate(
  confidence: number,
): SemanticConfidenceAction {
  if (confidence > 0.75) return "execute";
  if (confidence >= 0.4) return "confirm";
  return "clarify";
}

function logIntent(raw: string, intent: SemanticIntent): void {
  console.info(
    `[ripple-intent] raw=${JSON.stringify(raw.slice(0, 160))} intent=${intent.intent} confidence=${intent.confidence.toFixed(2)} target=${intent.target} action=${intent.action}`,
  );
}

function baseIntent(
  intent: SemanticIntentKind,
  action: string,
  confidence: number,
  notes = "",
  constraints: string[] = [],
): SemanticIntent {
  return {
    intent,
    target: "CURRENT_PROJECT",
    action,
    confidence,
    constraints,
    notes,
  };
}

export function classifySemanticIntent(
  rawCommand: string,
  normalized?: string,
): SemanticIntent {
  const raw = rawCommand.trim();
  const nrm = (normalized ?? raw).trim();
  const text = preferRawForSemantic(raw, nrm);
  const hay = `${raw}\n${nrm}\n${text}`;

  if (!text) {
    return baseIntent("NONE", "NONE", 0, "empty");
  }

  if (COMPOUND_NOTEPAD.test(hay)) {
    return baseIntent(
      "COMPOUND_WORKFLOW",
      "CHECK_SUMMARIZE_NOTE",
      0.9,
      "check issue → summarize → Notepad note",
    );
  }
  if (SECURITY_REVIEW.test(hay)) {
    return baseIntent("SECURITY_REVIEW", "REVIEW", 0.9, "security-oriented review");
  }
  if (DEPENDENCY_AUDIT.test(hay)) {
    return baseIntent("DEPENDENCY_AUDIT", "AUDIT", 0.9, "npm outdated + audit");
  }
  if (REQUIREMENTS_GAP.test(hay)) {
    return baseIntent(
      "REQUIREMENTS_GAP",
      "GAP_ANALYSIS",
      0.9,
      "missing requirements — never open_project",
      ["never_open_project"],
    );
  }
  if (PROJECT_ROADMAP.test(hay)) {
    return baseIntent("PROJECT_ROADMAP", "CREATE_ROADMAP", 0.88, "project roadmap");
  }
  if (COMPARE_TO_STANDARD.test(hay)) {
    return baseIntent(
      "COMPARE_TO_STANDARD",
      "COMPARE",
      0.88,
      "compare vs production standards",
    );
  }
  if (CODE_ANALYSIS.test(hay)) {
    return baseIntent("CODE_ANALYSIS", "ANALYZE", 0.92, "generic code analysis");
  }

  return baseIntent("NONE", "NONE", 0.2, "no semantic match");
}

/** True when Semantic should own the utterance (not local/dictation/adapters). */
export function isSemanticIntentUtterance(
  rawCommand: string,
  normalized?: string,
): boolean {
  if (shouldBypassSemanticIntent(rawCommand, normalized)) return false;
  const classified = classifySemanticIntent(rawCommand, normalized);
  return classified.intent !== "NONE" && classified.confidence >= 0.4;
}

/** Dictation / adapters / deterministic local open-close — Semantic must not steal. */
export function shouldBypassSemanticIntent(
  rawCommand: string,
  normalized?: string,
): boolean {
  const raw = rawCommand.trim();
  const nrm = (normalized ?? raw).trim();
  if (!raw) return true;
  if (shouldBypassP85Planner(raw)) return true;
  if (isWhatsAppPlannerUtterance(raw)) return true;
  if (isYouTubePlannerUtterance(raw, nrm)) return true;
  if (isGmailPlannerUtterance(raw, nrm)) return true;
  if (isLinkedInPlannerUtterance(raw, nrm)) return true;
  if (isInstagramPlannerUtterance(raw, nrm)) return true;
  if (isSendItemPlannerUtterance(raw)) return true;
  if (isNotionPlannerUtterance(raw, nrm)) return true;
  if (DETERMINISTIC_LOCAL.test(raw) || DETERMINISTIC_LOCAL.test(nrm)) return true;
  return false;
}

function step(
  tool: string,
  args: Record<string, unknown>,
  reason: string,
): PlanStep {
  return { tool, args, reason };
}

function planFromSteps(
  goal: string,
  confidence: number,
  steps: PlanStep[],
  raw: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal,
    confidence,
    steps,
    rawUtterance: raw,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function rootRef(): string {
  return INHERIT_PROJECT_ROOT;
}

function wantsShowReport(raw: string): boolean {
  return /\b(?:show|open|display|reveal)\b[\s\S]{0,24}\b(?:report|roadmap|findings|results?)\b|\band\s+show\s+(?:it|me|the\s+report)\b/i.test(
    raw,
  );
}

function reportSteps(
  intent: SemanticIntent,
  raw: string,
  extraCollect: PlanStep[],
): PlanStep[] {
  const root = rootRef();
  const schemaId = intentToSchemaId(intent.intent);
  const presentation = wantsShowReport(raw) ? "ide" : "none";
  return [
    ...extraCollect,
    step(
      "ai.synthesize_report",
      {
        schemaId: schemaId ?? "code-analysis",
        intent: intent.intent,
        projectRoot: root,
        presentation,
      },
      "semantic_synthesize_report",
    ),
  ];
}

function mapIntentToSteps(intent: SemanticIntent, raw: string): PlanStep[] {
  const root = rootRef();
  switch (intent.intent) {
    case "CODE_ANALYSIS":
      return reportSteps(intent, raw, [
        step("automation.scan_project", { projectRoot: root }, "semantic_code_scan"),
        step(
          "automation.analyze_codebase",
          { projectRoot: root },
          "semantic_code_analyze",
        ),
        step("automation.typecheck", { projectRoot: root }, "semantic_code_typecheck"),
      ]);
    case "SECURITY_REVIEW":
      return reportSteps(intent, raw, [
        step("automation.scan_project", { projectRoot: root }, "semantic_security_scan"),
        step(
          "automation.analyze_codebase",
          { projectRoot: root },
          "semantic_security_analyze",
        ),
        step(
          "automation.find_code",
          {
            projectRoot: root,
            query:
              "security vulnerability auth secret password token injection xss csrf",
          },
          "semantic_security_find",
        ),
      ]);
    case "DEPENDENCY_AUDIT":
      return reportSteps(intent, raw, [
        step(
          "automation.run_command",
          {
            // npm outdated exits 1 when packages are outdated — treat as success output.
            command:
              'powershell -NoProfile -Command "npm outdated 2>&1 | Out-String; if ($LASTEXITCODE -gt 1) { exit $LASTEXITCODE } else { exit 0 }"',
            cwd: root,
          },
          "semantic_deps_outdated",
        ),
        step(
          "automation.run_command",
          {
            // npm audit exits non-zero when vulns exist — still capture JSON for the report.
            command:
              'powershell -NoProfile -Command "npm audit --json 2>&1 | Out-String; if ($LASTEXITCODE -gt 1) { exit $LASTEXITCODE } else { exit 0 }"',
            cwd: root,
          },
          "semantic_deps_audit",
        ),
      ]);
    case "REQUIREMENTS_GAP":
      return reportSteps(intent, raw, [
        step("automation.scan_project", { projectRoot: root }, "semantic_req_scan"),
        step(
          "automation.analyze_codebase",
          { projectRoot: root },
          "semantic_req_analyze",
        ),
        step(
          "automation.find_code",
          {
            projectRoot: root,
            query: "TODO FIXME requirement acceptance criteria PRD roadmap",
          },
          "semantic_req_find",
        ),
      ]);
    case "PROJECT_ROADMAP":
      return reportSteps(intent, raw, [
        step("automation.scan_project", { projectRoot: root }, "semantic_roadmap_scan"),
        step(
          "automation.analyze_codebase",
          { projectRoot: root },
          "semantic_roadmap_analyze",
        ),
      ]);
    case "COMPARE_TO_STANDARD":
      return reportSteps(intent, raw, [
        step("automation.scan_project", { projectRoot: root }, "semantic_compare_scan"),
        step(
          "automation.analyze_codebase",
          { projectRoot: root },
          "semantic_compare_analyze",
        ),
      ]);
    case "COMPOUND_WORKFLOW":
      return reportSteps(intent, raw, [
        step("automation.scan_project", { projectRoot: root }, "semantic_compound_scan"),
        step(
          "automation.analyze_codebase",
          { projectRoot: root },
          "semantic_compound_analyze",
        ),
      ]);
    default:
      return [];
  }
}

function confirmQuestion(intent: SemanticIntent): string {
  switch (intent.intent) {
    case "SECURITY_REVIEW":
      return "Do you want me to run a security review on the current project?";
    case "DEPENDENCY_AUDIT":
      return "Do you want me to audit outdated and risky dependencies (npm outdated / npm audit)?";
    case "REQUIREMENTS_GAP":
      return "Do you want me to find missing requirements in the current project?";
    case "PROJECT_ROADMAP":
      return "Do you want me to create a roadmap to complete this project?";
    case "COMPARE_TO_STANDARD":
      return "Do you want me to compare your implementation with production standards?";
    case "COMPOUND_WORKFLOW":
      return "Do you want me to check the issue, summarize it, and make a Notepad note?";
    case "CODE_ANALYSIS":
      return "Do you want me to analyze the current project code?";
    default:
      return "I'm not sure what you meant. Can you say that again more specifically?";
  }
}

/** Pathful open-project compounds stay with P5.4 developer workflow. */
function isPathfulDeveloperCompound(raw: string, normalized: string): boolean {
  if (extractWindowsPath(raw) || extractWindowsPath(normalized)) return true;
  return (
    /\bopen\s+(?:the\s+|my\s+)?project\b/i.test(raw) ||
    /\bopen\s+(?:the\s+|my\s+)?project\b/i.test(normalized)
  );
}

/**
 * Semantic Intent → L0 plan / clarify. Returns null when Semantic should not own the turn.
 */
export function trySemanticIntentPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  if (shouldBypassSemanticIntent(rawCommand, normalized)) return null;

  const intent = classifySemanticIntent(rawCommand, normalized);
  logIntent(rawCommand, intent);

  if (intent.intent === "NONE") return null;

  // Keep classic "open project at C:\… then analyze/fix" on developer workflow.
  if (
    intent.intent === "CODE_ANALYSIS" &&
    isPathfulDeveloperCompound(rawCommand, normalized)
  ) {
    return null;
  }

  const gate = applySemanticConfidenceGate(intent.confidence);
  if (gate === "clarify") {
    return {
      kind: "clarify",
      question: confirmQuestion(intent),
      confidence: intent.confidence,
      reason: "semantic_clarify",
    };
  }
  if (gate === "confirm") {
    return {
      kind: "clarify",
      question: confirmQuestion(intent),
      confidence: intent.confidence,
      reason: "semantic_confirm",
    };
  }

  const steps = mapIntentToSteps(intent, rawCommand.trim());
  if (!steps.length) return null;

  // Hard safety: requirements gap must never open_project.
  if (
    intent.intent === "REQUIREMENTS_GAP" &&
    steps.some((s) => s.tool === "automation.open_project")
  ) {
    return {
      kind: "clarify",
      question: "I can analyze missing requirements, but I won't open a project from that phrase. Which project root should I use?",
      confidence: 0.7,
      reason: "semantic_requirements_no_open",
    };
  }

  return {
    kind: "plan",
    plan: planFromSteps(
      `Semantic: ${intent.intent}`,
      intent.confidence,
      steps,
      rawCommand,
      normalized,
    ),
  };
}
