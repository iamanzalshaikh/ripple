import type {
  CompoundStepPreview,
  ExecutionPlan,
  L0PlannerResult,
  PlanStep,
} from "./planTypes.js";
import { extractWindowsPath } from "./parseAutomationClause.js";
import { INHERIT_PROJECT_ROOT } from "./inheritContext.js";
import {
  clearPendingCodeRepair,
  getPendingCodeRepair,
  setPendingCodeRepair,
} from "./codeRepairSession.js";
import { proposeCodeRepairsFromDiagnostics } from "../../automation/shell/proposeCodeRepairs.js";
import { classifySemanticIntent } from "./semanticIntentRouter.js";

/** Specialized Semantic intents must not collapse into generic scan+lint success. */
function isSpecializedSemanticOwned(
  rawCommand: string,
  normalized: string,
): boolean {
  const intent = classifySemanticIntent(rawCommand, normalized);
  if (intent.intent === "NONE" || intent.intent === "CODE_ANALYSIS") return false;
  return intent.confidence >= 0.4;
}

const CODE_DISCOVERY =
  /\b(?:find|identify|analy[sz]e|inspect|debug|audit|review)\b[\s\S]*\b(?:code|codebase|issues?|errors?|bugs?|broken|affected files?|project)\b/i;
/** STT often hears "bug" as "work" — still treat as discovery. */
const CODE_DISCOVERY_STT =
  /\bfind\b[\s\S]{0,24}?\bpotential\s+work\b[\s\S]{0,40}?\b(?:code|project|repo)\b/i;
const CODE_DISCOVERY_NLU =
  /\b(?:any\s+)?existing\s+code\s+issues?\b|\bcode\s+issues?\b/i;

/** Matches natural "apply the safe fixes" / "fix TypeScript errors" / etc. */
const CODE_REPAIR =
  /\bapply\b[\s\w'-]{0,40}?\bfix(?:es)?\b|\bfix\b[\s\w'-]{0,40}?\b(?:the\s+)?(?:typescript\s+|type\s*script\s+)?(?:errors?|issues?|bugs?|problems?|affected files?)\b|\b(?:fix|repair|patch)\b[\s\S]{0,80}?\b(?:issues?|errors?|bugs?|problems?|affected files?|fixes?)\b|\b(?:issues?|errors?|bugs?|problems?|affected files?)\b[\s\S]{0,80}?\b(?:fix|repair|patch|apply)\b/i;

const RUN_TESTS =
  /\b(?:run|execute)\b[\s\S]*\b(?:project\s+)?tests?\b|\bverify (?:the )?fixes?\b/i;
const DEVELOPER_PROJECT =
  /\b(?:open|analyze|inspect|check|audit|review|scan)\s+(?:the\s+|my\s+)?(?:project|workspace|codebase)\b/i;
const WANTS_OPEN =
  /\bopen\s+(?:(?:the\s+|my\s+)?(?:project|workspace|codebase)|[\w. \\/:()-]+\.(?:ts|tsx|js|jsx)?|my\s+project\s+at)\b|\bopen\s+my\s+project\b/i;
const WANTS_TYPECHECK =
  /\b(?:typescript|type[\s-]?check|tsc)\b/i;
const WANTS_LINT = /\b(?:eslint|lint)\b/i;
const NEEDS_VOICE_CONFIRM =
  /\bafter confirmation\b|\bafter you confirm\b|\bask (?:me )?before (?:fixing|patching|applying)\b/i;

/** Confirmation after a deferred CODE_REPAIR clarify. */
const REPAIR_CONFIRM =
  /^(?:yes|yep|yeah|ok|okay|sure|confirm|proceed|go ahead|do it|apply(?: the)?(?: safe)? fix(?:es)?|apply(?: the)? patches?|fix (?:it|them|the (?:issues?|problems?|errors?|bugs?))|yes[,.]?\s*(?:please\s+)?(?:fix|apply|patch|run))\b/i;

const CODE_REPAIR_UNRESOLVED =
  /fix (?:the )?affected files|apply (?:the )?(?:safe )?fix(?:es)?|code[_\s-]?repair/i;

function projectStep(path: string): PlanStep {
  return {
    tool: "automation.open_project",
    args: { path },
    reason: "developer_workflow_open_project",
  };
}

function scanStep(projectRoot: string): PlanStep {
  return {
    tool: "automation.scan_project",
    args: { projectRoot },
    reason: "developer_workflow_scan_project",
  };
}

function analyzeStep(projectRoot: string): PlanStep {
  return {
    tool: "automation.analyze_codebase",
    args: { projectRoot },
    reason: "developer_workflow_analyze_codebase",
  };
}

function typecheckStep(projectRoot: string): PlanStep {
  return {
    tool: "automation.typecheck",
    args: { projectRoot },
    reason: "developer_workflow_typecheck",
  };
}

function lintStep(projectRoot: string): PlanStep {
  return {
    tool: "automation.lint",
    args: { projectRoot },
    reason: "developer_workflow_lint",
  };
}

function testsStep(projectRoot: string): PlanStep {
  return {
    tool: "automation.run_tests",
    args: { projectRoot },
    reason: "developer_workflow_run_tests",
  };
}

function pushPreview(
  preview: CompoundStepPreview[],
  clause: string,
  tool: string,
  summary: string,
): void {
  preview.push({
    index: preview.length,
    clause,
    status: "resolved",
    tool,
    action: "AUTOMATION",
    summary,
  });
}

function buildRepairStepsFromPending(options?: {
  forceTests?: boolean;
}): PlanStep[] | null {
  const pending = getPendingCodeRepair();
  if (!pending) return null;

  const projectRoot = pending.projectPath;
  const proposals = proposeCodeRepairsFromDiagnostics(
    projectRoot,
    pending.diagnostics,
  );
  if (proposals.length === 0) return null;

  const steps: PlanStep[] = proposals.map((p, index) => ({
    tool: "filesystem.patch_file",
    args: {
      path: p.path,
      find: p.find,
      replace: p.replace,
    },
    reason: `code_repair_patch_${index + 1}`,
  }));
  steps.push(typecheckStep(projectRoot));

  const wantsTests = options?.forceTests ?? pending.wantsTests;
  if (wantsTests) {
    steps.push(testsStep(projectRoot));
  }
  return steps;
}

/**
 * After audit clarify: user confirms → concrete patch_file steps + recheck (+ tests).
 */
export function tryCodeRepairConfirmPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const text = rawCommand.trim();
  if (!REPAIR_CONFIRM.test(text) && !REPAIR_CONFIRM.test(normalized.trim())) {
    return null;
  }

  const pending = getPendingCodeRepair();
  if (!pending) return null;

  const projectRoot = pending.projectPath;
  const wantsTests =
    pending.wantsTests ||
    RUN_TESTS.test(text) ||
    /\brun\s+(?:the\s+)?tests?\b/i.test(text);

  const steps = buildRepairStepsFromPending({ forceTests: wantsTests });
  if (!steps) {
    const diagCount = pending.diagnostics.length;
    console.info(
      `[ripple-p85] code_repair: no safe auto-patch from ${diagCount} diagnostic(s) root=${projectRoot}`,
    );
    return {
      kind: "clarify",
      question:
        diagCount > 0
          ? `I found ${diagCount} TypeScript error(s) but none have a safe automatic patch yet. Review the typecheck report and tell me the exact change (file + find/replace), or wait for AI patch planning.`
          : "TypeScript found 0 errors in the last audit, so auto-fix has nothing to patch. Heuristic warnings (console.error etc.) are not auto-fixed — only safe tsc syntax/type errors are. Run typecheck on a project that actually fails, then say Apply Fixes again.",
      confidence: 0.85,
      reason: "code_repair_no_safe_patch",
    };
  }

  console.info(
    `[ripple-p85] code_repair: proposing ${steps.filter((s) => s.tool === "filesystem.patch_file").length} patch(es)`,
  );
  clearPendingCodeRepair();

  return {
    kind: "plan",
    plan: {
      goal: "Apply confirmed safe code repairs",
      confidence: 0.9,
      steps,
      rawUtterance: rawCommand,
      normalizedUtterance: normalized,
      source: "L0",
    },
  };
}

/**
 * Phase B tail — after audit typecheck recorded diagnostics, apply patches
 * when the original utterance already asked to apply/fix (autoApply).
 */
export function tryPlanCodeRepairTail(
  unresolvedClauses: string[],
  ctx: { rawCommand: string; normalized: string },
): ExecutionPlan | null {
  const hasRepairClause = unresolvedClauses.some((c) =>
    CODE_REPAIR_UNRESOLVED.test(c),
  );
  if (!hasRepairClause) return null;

  const pending = getPendingCodeRepair();
  if (!pending) return null;

  // Voice-only defer: require "yes, apply fixes" unless autoApply was set.
  if (!pending.autoApply) return null;

  const steps = buildRepairStepsFromPending();
  if (!steps) {
    console.info(
      `[ripple-p85] code_repair tail: diagnostics=${pending.diagnostics.length} but no safe patch yet`,
    );
    return null;
  }

  console.info(
    `[ripple-p85] code_repair auto-tail patches=${steps.filter((s) => s.tool === "filesystem.patch_file").length} root=${pending.projectPath}`,
  );
  clearPendingCodeRepair();

  return {
    goal: "Apply safe code repairs from audit",
    confidence: 0.9,
    steps,
    rawUtterance: ctx.rawCommand,
    normalizedUtterance: ctx.normalized,
    source: "L0",
  };
}

/**
 * Deterministic P5.4 developer workflow expansion.
 *
 * Pipeline: open → scan → analyze → typecheck → lint → (repair) → (tests)
 */
export function tryDeveloperWorkflowPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const confirm = tryCodeRepairConfirmPlan(rawCommand, normalized);
  if (confirm) return confirm;

  if (isSpecializedSemanticOwned(rawCommand, normalized)) {
    return null;
  }

  const text = rawCommand.trim();
  const nrm = normalized.trim();
  const path = extractWindowsPath(text) ?? extractWindowsPath(nrm);

  const wantsOpen = WANTS_OPEN.test(text) || /\bopen\s+my\s+project\s+at\b/i.test(text);
  const wantsDiscovery =
    CODE_DISCOVERY.test(text) ||
    CODE_DISCOVERY.test(nrm) ||
    CODE_DISCOVERY_STT.test(text) ||
    CODE_DISCOVERY_STT.test(nrm) ||
    CODE_DISCOVERY_NLU.test(text) ||
    CODE_DISCOVERY_NLU.test(nrm);
  const wantsRepair = CODE_REPAIR.test(text) || CODE_REPAIR.test(nrm);
  const wantsTests = RUN_TESTS.test(text) || RUN_TESTS.test(nrm);
  const wantsTypecheck = WANTS_TYPECHECK.test(text) || WANTS_TYPECHECK.test(nrm);
  const wantsLint = WANTS_LINT.test(text) || WANTS_LINT.test(nrm);
  const hasProjectVerb = DEVELOPER_PROJECT.test(text) || DEVELOPER_PROJECT.test(nrm);
  const needsVoiceConfirm = NEEDS_VOICE_CONFIRM.test(text) || NEEDS_VOICE_CONFIRM.test(nrm);

  const isWorkflow =
    hasProjectVerb ||
    wantsTypecheck ||
    wantsLint ||
    wantsDiscovery ||
    wantsRepair ||
    wantsTests;
  if (!isWorkflow) return null;

  // Pathless discovery/repair (e.g. "analyze the code and check for bugs") uses
  // sticky / live IDE workspace via INHERIT_PROJECT_ROOT — do not require an
  // explicit C:\ path, and do not fall through to compound clarify.
  if (!path && !wantsDiscovery && !wantsRepair && !wantsTests && !wantsTypecheck && !wantsLint) {
    return null;
  }
  if (wantsOpen && !path) {
    return null;
  }

  if (
    !wantsOpen &&
    !wantsDiscovery &&
    !wantsRepair &&
    !wantsTests &&
    !wantsTypecheck &&
    !wantsLint
  ) {
    return null;
  }

  const steps: PlanStep[] = [];
  const preview: CompoundStepPreview[] = [];
  const rootRef = path ?? INHERIT_PROJECT_ROOT;

  if (wantsOpen && path) {
    steps.push(projectStep(path));
    pushPreview(preview, `Open project "${path}"`, "automation.open_project", "Open project");
  }

  const wantsInspection =
    wantsDiscovery || wantsRepair || wantsTypecheck || wantsLint;
  if (wantsInspection) {
    steps.push(scanStep(rootRef));
    pushPreview(
      preview,
      "Scan project structure and priority files",
      "automation.scan_project",
      "Scan project",
    );
  }

  if (wantsDiscovery || wantsRepair) {
    steps.push(analyzeStep(rootRef));
    pushPreview(
      preview,
      "Analyze codebase and report heuristic issues",
      "automation.analyze_codebase",
      "Analyze codebase",
    );
  }

  if (wantsDiscovery || wantsRepair || wantsTypecheck) {
    steps.push(typecheckStep(rootRef));
    pushPreview(
      preview,
      "Run TypeScript compiler check",
      "automation.typecheck",
      "TypeScript check",
    );
  }

  if (wantsDiscovery || wantsRepair || wantsLint) {
    steps.push(lintStep(rootRef));
    pushPreview(
      preview,
      "Run ESLint check",
      "automation.lint",
      "ESLint check",
    );
  }

  if (wantsRepair) {
    const autoApply = !needsVoiceConfirm;
    setPendingCodeRepair({
      projectPath: path ?? INHERIT_PROJECT_ROOT,
      wantsTests,
      autoApply,
      sourceUtterance: rawCommand,
    });

    const unresolved = autoApply
      ? "apply the safe fixes from typecheck"
      : "fix the affected files after confirmation";
    preview.push({
      index: preview.length,
      clause: unresolved,
      status: "unresolved",
      action: "CODE_REPAIR",
      summary: autoApply
        ? "Patch after typecheck (UI confirm)"
        : "Needs voice confirmation",
    });
    if (wantsTests) {
      preview.push({
        index: preview.length,
        clause: "run the project tests after the fix",
        status: "unresolved",
        action: "AUTOMATION",
        summary: "Deferred until repair succeeds",
      });
    }
    return {
      kind: "partial",
      plan: {
        goal: autoApply
          ? "Inspect project then apply safe fixes"
          : "Inspect project before confirmed code repair",
        confidence: 0.92,
        steps,
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
      unresolvedClauses: [
        unresolved,
        ...(wantsTests ? ["run the project tests after the fix"] : []),
      ],
      splitPreview: preview,
      question: autoApply
        ? "I'll open the project, run checks, then apply safe auto-fixes (you'll confirm each patch)."
        : 'I opened the project, scanned it, ran TypeScript/ESLint checks, and analyzed likely issues. Review the report, then say "yes, apply fixes" (or "confirm") and I will patch safe auto-fixes, re-typecheck, and run tests if you asked for them.',
      confidence: 0.9,
      reason: "compound_partial",
    };
  }

  if (wantsTests) {
    steps.push(testsStep(rootRef));
    pushPreview(
      preview,
      "Run project tests",
      "automation.run_tests",
      "Run project tests",
    );
  }

  return {
    kind: "plan",
    plan: {
      goal: "Developer project workflow",
      confidence: 0.92,
      steps,
      rawUtterance: rawCommand,
      normalizedUtterance: normalized,
      source: "L0",
    },
  };
}

/** True when utterance should use developer workflow instead of generic compound v2. */
export function isDeveloperWorkflowUtterance(
  rawCommand: string,
  normalized?: string,
): boolean {
  const text = rawCommand.trim();
  const nrm = (normalized ?? rawCommand).trim();
  if (
    getPendingCodeRepair() &&
    (REPAIR_CONFIRM.test(text) || REPAIR_CONFIRM.test(nrm))
  ) {
    return true;
  }
  if (isSpecializedSemanticOwned(text, nrm)) {
    return false;
  }
  const hasPath = Boolean(extractWindowsPath(text) ?? extractWindowsPath(nrm));
  const discovery =
    CODE_DISCOVERY.test(text) ||
    CODE_DISCOVERY.test(nrm) ||
    CODE_DISCOVERY_STT.test(text) ||
    CODE_DISCOVERY_STT.test(nrm) ||
    CODE_DISCOVERY_NLU.test(text) ||
    CODE_DISCOVERY_NLU.test(nrm);
  const repair = CODE_REPAIR.test(text) || CODE_REPAIR.test(nrm);
  const tests = RUN_TESTS.test(text) || RUN_TESTS.test(nrm);
  const typecheck = WANTS_TYPECHECK.test(text) || WANTS_TYPECHECK.test(nrm);
  const lint = WANTS_LINT.test(text) || WANTS_LINT.test(nrm);
  const projectVerb = DEVELOPER_PROJECT.test(text) || DEVELOPER_PROJECT.test(nrm);
  const wantsOpen =
    WANTS_OPEN.test(text) ||
    WANTS_OPEN.test(nrm) ||
    /\bopen\s+my\s+project\s+at\b/i.test(text);

  // Open-with-path still requires a concrete path; analysis/repair can be pathless.
  if (wantsOpen && !hasPath && !discovery && !repair) return false;

  return (
    wantsOpen ||
    discovery ||
    repair ||
    tests ||
    typecheck ||
    lint ||
    projectVerb
  );
}
