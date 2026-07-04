import type { WorldModel } from "../types.js";

export type ToolCategory =
  | "desktop"
  | "browser"
  | "memory"
  | "system"
  | "communication"
  | "search"
  | "apps";

export type PlanSource = "L0" | "GPT" | "cache";

export interface ToolArgSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  argsSchema: Record<string, ToolArgSchema>;
  requiresPermission?: string;
  wave: 1 | 2;
}

export interface PlanStep {
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
}

export interface ExecutionPlan {
  goal: string;
  confidence: number;
  steps: PlanStep[];
  needsClarification?: boolean;
  clarificationQuestion?: string;
  rawUtterance: string;
  normalizedUtterance: string;
  source: PlanSource;
  /** Debugging provenance — §4a.10 */
  plannerVersion?: string;
  toolManifestVersion?: string;
  worldVersion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedPlan?: ExecutionPlan;
}

export interface PlannerClarifyResult {
  kind: "clarify";
  question: string;
  options?: string[];
  confidence: number;
  reason: string;
  plan?: ExecutionPlan;
}

export interface PlannerExecuteResult {
  kind: "execute";
  plan: ExecutionPlan;
  validation: ValidationResult;
}

export interface PlannerDeferResult {
  kind: "defer";
  reason: string;
  normalizedUtterance: string;
}

/** One clause in a compound split — for Phase B logging / UI. */
export interface CompoundStepPreview {
  index: number;
  clause: string;
  status: "resolved" | "unresolved";
  tool?: string;
  action?: string;
  summary?: string;
}

export interface PlannerPartialResult {
  kind: "partial";
  plan: ExecutionPlan;
  unresolvedClauses: string[];
  splitPreview: CompoundStepPreview[];
  question: string;
  confidence: number;
  reason: "compound_partial";
}

export type PlannerPipelineResult =
  | PlannerExecuteResult
  | PlannerClarifyResult
  | PlannerPartialResult
  | PlannerDeferResult;

export interface PlannerPipelineInput {
  command: string;
  world: WorldModel;
  execute?: boolean;
}

export type L0PlannerResult =
  | { kind: "plan"; plan: ExecutionPlan }
  | {
      kind: "clarify";
      question: string;
      options?: string[];
      confidence: number;
      reason: string;
    }
  | {
      kind: "partial";
      plan: ExecutionPlan;
      unresolvedClauses: string[];
      splitPreview: CompoundStepPreview[];
      question: string;
      confidence: number;
      reason: "compound_partial";
    }
  | { kind: "defer"; reason: string };

export interface PlannerShadowRecord {
  rawUtterance: string;
  normalizedUtterance: string;
  resultKind: string;
  source?: PlanSource;
  goal?: string;
  tools?: string[];
  confidence?: number;
  validationErrors?: string[];
  reason?: string;
  latencyMs: number;
}
