/**
 * First-class workflow state for evidence-driven Semantic reports.
 * Owns meaning + provenance only; executor still owns tools & safety.
 */

export type WorkflowStatus =
  | "planned"
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

export type EvidenceFindingStatus =
  | "confirmed"
  | "potential"
  | "informational"
  | "needs_review";

export type ArtifactKind = "report" | "session" | "memory" | "execution";

export type ArtifactPresentation = "none" | "inline" | "open" | "reveal" | "ide";

export type WorkflowProject = {
  name: string;
  rootPath: string;
};

export type WorkflowStepResult = {
  index: number;
  tool: string;
  ok: boolean;
  error?: string;
  /** Bounded, redacted preview — never raw secrets. */
  outputPreview?: string;
  /** Opaque handle into evidence store for this step. */
  evidenceIds: string[];
  startedAt: string;
  finishedAt: string;
  observationOk?: boolean;
  observationReason?: string;
};

export type EvidenceItem = {
  id: string;
  type: string;
  tool: string;
  stepIndex: number;
  status: EvidenceFindingStatus;
  confidence: number;
  title: string;
  detail: string;
  file?: string;
  line?: number;
  severity?: "low" | "medium" | "high" | "critical";
  corroborationCount: number;
  redacted: boolean;
  producedAt: string;
  /** Raw excerpt already redacted + size-capped. */
  excerpt?: string;
};

export type ArtifactRef = {
  id: string;
  kind: ArtifactKind;
  path: string;
  schemaId?: string;
  contentType: string;
  createdAt: string;
  presentation: ArtifactPresentation;
};

export type OmissionSummary = {
  truncatedEvidence: number;
  redactedSecrets: number;
  skippedFiles: number;
  reasons: string[];
};

export type WorkflowContext = {
  workflowId: string;
  intent: string;
  schemaId?: string;
  project: WorkflowProject | null;
  userRequest: string;
  steps: WorkflowStepResult[];
  evidence: EvidenceItem[];
  artifacts: ArtifactRef[];
  omissions: OmissionSummary;
  status: WorkflowStatus;
  presentation: ArtifactPresentation;
  createdAt: string;
  updatedAt: string;
};

export const WORKFLOW_EVIDENCE_REF = "__WORKFLOW_EVIDENCE__";
export const WORKFLOW_CONTEXT_REF = "__WORKFLOW_CONTEXT__";

export function createEmptyOmissions(): OmissionSummary {
  return {
    truncatedEvidence: 0,
    redactedSecrets: 0,
    skippedFiles: 0,
    reasons: [],
  };
}

export function createWorkflowContext(input: {
  intent?: string;
  userRequest: string;
  project?: WorkflowProject | null;
  schemaId?: string;
  presentation?: ArtifactPresentation;
}): WorkflowContext {
  const now = new Date().toISOString();
  return {
    workflowId: `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    intent: input.intent ?? "NONE",
    schemaId: input.schemaId,
    project: input.project ?? null,
    userRequest: input.userRequest,
    steps: [],
    evidence: [],
    artifacts: [],
    omissions: createEmptyOmissions(),
    status: "planned",
    presentation: input.presentation ?? "none",
    createdAt: now,
    updatedAt: now,
  };
}

export function touchWorkflow(ctx: WorkflowContext): void {
  ctx.updatedAt = new Date().toISOString();
}
