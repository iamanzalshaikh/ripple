/**
 * Evidence redaction + normalization for Semantic report synthesis.
 */
import type {
  EvidenceFindingStatus,
  EvidenceItem,
  OmissionSummary,
  WorkflowContext,
} from "../planner/workflowTypes.js";
import { createEmptyOmissions } from "../planner/workflowTypes.js";

export const MAX_EVIDENCE_ITEMS = 40;
export const MAX_EXCERPT_CHARS = 400;
export const MAX_OUTPUT_PREVIEW_CHARS = 2_000;
export const MAX_BUNDLE_CHARS = 24_000;

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[:=]\s*['"]?[^\s'"]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
];

const ENV_PATH = /(?:^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?$/i;
const LOCKFILE = /(?:^|[\\/])(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;
const GENERATED = /(?:^|[\\/])(?:node_modules|\.next|dist|build|coverage|\.turbo)(?:[\\/]|$)/i;

export function redactSecrets(text: string): { text: string; redacted: number } {
  let out = text;
  let redacted = 0;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      redacted += 1;
      return "[REDACTED]";
    });
  }
  return { text: out, redacted };
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

export function shouldSkipEvidencePath(filePath: string): string | null {
  if (ENV_PATH.test(filePath)) return "env_file";
  if (LOCKFILE.test(filePath)) return "lockfile";
  if (GENERATED.test(filePath)) return "generated_path";
  return null;
}

export function boundOutputPreview(output: unknown): string {
  let raw: string;
  if (typeof output === "string") raw = output;
  else {
    try {
      raw = JSON.stringify(output);
    } catch {
      raw = String(output);
    }
  }
  const { text } = redactSecrets(raw);
  return truncateText(text, MAX_OUTPUT_PREVIEW_CHARS);
}

function parseFileLine(line: string): { file?: string; line?: number; rest: string } {
  const m = line.match(/^([^:]+):(\d+):(.*)$/);
  if (!m) return { rest: line };
  return {
    file: m[1]?.trim(),
    line: Number(m[2]),
    rest: (m[3] ?? "").trim(),
  };
}

function classifyFromTool(
  tool: string,
  title: string,
  detail: string,
): { status: EvidenceFindingStatus; confidence: number; severity?: EvidenceItem["severity"] } {
  const hay = `${title}\n${detail}`.toLowerCase();

  // Deterministic analyzer heuristics → confirmed/informational
  if (tool === "automation.analyze_codebase") {
    if (/no "test" script|console\.error|empty catch|missing try\/catch/i.test(hay)) {
      return { status: "confirmed", confidence: 0.86, severity: "medium" };
    }
    return { status: "informational", confidence: 0.7, severity: "low" };
  }

  // Keyword search hits are potential unless strongly corroborated later
  if (tool === "automation.find_code") {
    if (/\b(password|secret|token|apikey|api_key)\b/i.test(hay)) {
      return { status: "potential", confidence: 0.62, severity: "high" };
    }
    if (/\b(auth|security|csrf|xss|inject)\b/i.test(hay)) {
      return { status: "potential", confidence: 0.55, severity: "medium" };
    }
    return { status: "informational", confidence: 0.45, severity: "low" };
  }

  if (tool === "automation.run_command") {
    if (/npm\s+audit/i.test(hay) || /"severity"\s*:\s*"(critical|high)"/i.test(hay)) {
      return { status: "confirmed", confidence: 0.9, severity: "high" };
    }
    if (/npm\s+outdated/i.test(hay) || /\bwanted\b|\blatest\b/i.test(hay)) {
      return { status: "confirmed", confidence: 0.85, severity: "medium" };
    }
    return { status: "informational", confidence: 0.6 };
  }

  if (tool === "automation.scan_project" || tool === "automation.typecheck") {
    return { status: "informational", confidence: 0.75, severity: "low" };
  }

  return { status: "needs_review", confidence: 0.5 };
}

function makeId(stepIndex: number, n: number): string {
  return `ev_${stepIndex}_${n}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Normalize a tool result into evidence items.
 * Keyword matches stay potential; analyzer/command findings may be confirmed.
 */
export function normalizeToolOutputToEvidence(input: {
  tool: string;
  stepIndex: number;
  output: unknown;
  ok: boolean;
  omissions?: OmissionSummary;
}): { items: EvidenceItem[]; omissions: OmissionSummary } {
  const omissions = input.omissions ?? createEmptyOmissions();
  const items: EvidenceItem[] = [];
  const now = new Date().toISOString();

  if (!input.ok) {
    items.push({
      id: makeId(input.stepIndex, 0),
      type: "tool_failure",
      tool: input.tool,
      stepIndex: input.stepIndex,
      status: "needs_review",
      confidence: 0.9,
      title: `${input.tool} failed`,
      detail: boundOutputPreview(input.output ?? "failed"),
      corroborationCount: 0,
      redacted: false,
      producedAt: now,
    });
    return { items, omissions };
  }

  const preview = boundOutputPreview(input.output);
  const { text: redactedPreview, redacted } = redactSecrets(preview);
  if (redacted > 0) {
    omissions.redactedSecrets += redacted;
    omissions.reasons.push(`${input.tool}:redacted_secrets`);
  }

  const lines = redactedPreview
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (input.tool === "automation.find_code") {
    let n = 0;
    for (const line of lines.slice(0, 30)) {
      const parsed = parseFileLine(line);
      if (parsed.file) {
        const skip = shouldSkipEvidencePath(parsed.file);
        if (skip) {
          omissions.skippedFiles += 1;
          omissions.reasons.push(`skip:${skip}:${parsed.file}`);
          continue;
        }
      }
      const cls = classifyFromTool(input.tool, parsed.rest || line, line);
      items.push({
        id: makeId(input.stepIndex, n++),
        type: "code_match",
        tool: input.tool,
        stepIndex: input.stepIndex,
        status: cls.status,
        confidence: cls.confidence,
        severity: cls.severity,
        title: truncateText(parsed.rest || "code match", 120),
        detail: truncateText(line, MAX_EXCERPT_CHARS),
        file: parsed.file,
        line: parsed.line,
        corroborationCount: 0,
        redacted: redacted > 0,
        producedAt: now,
        excerpt: truncateText(parsed.rest || line, MAX_EXCERPT_CHARS),
      });
    }
  } else if (input.tool === "automation.analyze_codebase") {
    // Split on numbered findings when present
    const chunks = redactedPreview.split(/\n(?=\d+\.\s)/);
    let n = 0;
    for (const chunk of chunks.slice(0, 20)) {
      if (!/issue|found|summary|analyzing|scanning/i.test(chunk) && chunk.length < 40) {
        continue;
      }
      if (/^analyzing codebase|^scanning:|^summary:/i.test(chunk.trim())) {
        continue;
      }
      const fileMatch = chunk.match(
        /(?:^|\n)(?:\d+\.\s*)?([^\n]+?\.(?:tsx|ts|jsx|json|js|py|go|rs))/i,
      );
      const file = fileMatch?.[1]?.trim();
      if (file) {
        const skip = shouldSkipEvidencePath(file);
        if (skip) {
          omissions.skippedFiles += 1;
          continue;
        }
      }
      const cls = classifyFromTool(input.tool, chunk, chunk);
      items.push({
        id: makeId(input.stepIndex, n++),
        type: "analysis_finding",
        tool: input.tool,
        stepIndex: input.stepIndex,
        status: cls.status,
        confidence: cls.confidence,
        severity: cls.severity,
        title: truncateText(chunk.split("\n").find((l) => l.trim()) || "analysis finding", 120),
        detail: truncateText(chunk, MAX_EXCERPT_CHARS),
        file,
        corroborationCount: 0,
        redacted: redacted > 0,
        producedAt: now,
        excerpt: truncateText(chunk, MAX_EXCERPT_CHARS),
      });
    }
    if (items.length === 0) {
      items.push({
        id: makeId(input.stepIndex, 0),
        type: "analysis_summary",
        tool: input.tool,
        stepIndex: input.stepIndex,
        status: "informational",
        confidence: 0.7,
        title: "Codebase analysis summary",
        detail: truncateText(redactedPreview, MAX_EXCERPT_CHARS),
        corroborationCount: 0,
        redacted: redacted > 0,
        producedAt: now,
        excerpt: truncateText(redactedPreview, MAX_EXCERPT_CHARS),
      });
    }
  } else {
    items.push({
      id: makeId(input.stepIndex, 0),
      type: "tool_output",
      tool: input.tool,
      stepIndex: input.stepIndex,
      ...classifyFromTool(input.tool, input.tool, redactedPreview),
      title: `${input.tool} output`,
      detail: truncateText(redactedPreview, MAX_EXCERPT_CHARS),
      corroborationCount: 0,
      redacted: redacted > 0,
      producedAt: now,
      excerpt: truncateText(redactedPreview, MAX_EXCERPT_CHARS),
    });
  }

  return { items, omissions };
}

/** Cap evidence list and record omissions. */
export function capEvidence(
  items: EvidenceItem[],
  omissions: OmissionSummary,
  max = MAX_EVIDENCE_ITEMS,
): EvidenceItem[] {
  if (items.length <= max) return items;
  const dropped = items.length - max;
  omissions.truncatedEvidence += dropped;
  omissions.reasons.push(`truncated_evidence:${dropped}`);
  return items.slice(0, max);
}

/**
 * Build a network-safe evidence bundle for backend synthesis.
 * Never includes env secrets or lockfile dumps.
 */
export function buildEvidenceBundle(workflow: WorkflowContext): {
  bundle: {
    workflowId: string;
    intent: string;
    schemaId?: string;
    userRequest: string;
    project: WorkflowContext["project"];
    evidence: Array<{
      id: string;
      type: string;
      tool: string;
      status: EvidenceFindingStatus;
      confidence: number;
      title: string;
      detail: string;
      file?: string;
      line?: number;
      severity?: string;
    }>;
    omissions: OmissionSummary;
    stepSummaries: Array<{ index: number; tool: string; ok: boolean }>;
  };
  charCount: number;
} {
  const evidence = workflow.evidence.slice(0, MAX_EVIDENCE_ITEMS).map((e) => ({
    id: e.id,
    type: e.type,
    tool: e.tool,
    status: e.status,
    confidence: e.confidence,
    title: truncateText(e.title, 160),
    detail: truncateText(e.detail, MAX_EXCERPT_CHARS),
    file: e.file,
    line: e.line,
    severity: e.severity,
  }));

  const bundle = {
    workflowId: workflow.workflowId,
    intent: workflow.intent,
    schemaId: workflow.schemaId,
    userRequest: truncateText(workflow.userRequest, 500),
    project: workflow.project,
    evidence,
    omissions: workflow.omissions,
    stepSummaries: workflow.steps.map((s) => ({
      index: s.index,
      tool: s.tool,
      ok: s.ok,
    })),
  };

  let json = JSON.stringify(bundle);
  if (json.length > MAX_BUNDLE_CHARS) {
    const shrink = Math.max(5, Math.floor(evidence.length / 2));
    bundle.evidence = evidence.slice(0, shrink);
    bundle.omissions.truncatedEvidence += evidence.length - shrink;
    bundle.omissions.reasons.push("bundle_char_cap");
    json = JSON.stringify(bundle);
  }

  return { bundle, charCount: json.length };
}

/** LLM synthesis must not promote status beyond local assignment. */
export function clampSynthesizedStatus(
  local: EvidenceFindingStatus,
  proposed: string | undefined,
): EvidenceFindingStatus {
  const order: EvidenceFindingStatus[] = [
    "informational",
    "needs_review",
    "potential",
    "confirmed",
  ];
  const prop = (["confirmed", "potential", "informational", "needs_review"] as const).includes(
    proposed as EvidenceFindingStatus,
  )
    ? (proposed as EvidenceFindingStatus)
    : local;
  return order.indexOf(prop) <= order.indexOf(local) ? prop : local;
}
