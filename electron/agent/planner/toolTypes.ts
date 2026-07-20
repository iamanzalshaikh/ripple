import type { ForegroundWindow, WorldModel } from "../types.js";

/** Frozen category allowlist — do not add desktop2, windows, native, utility, etc. */
export const FROZEN_TOOL_CATEGORIES = [
  "desktop",
  "filesystem",
  "browser",
  "system",
  "memory",
  "communication",
  "automation",
  "ai",
] as const;

export type FrozenToolCategory = (typeof FROZEN_TOOL_CATEGORIES)[number];

export type ToolRisk = "low" | "medium" | "high";

export interface ToolArgSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  enum?: string[];
  description?: string;
}

/** Executable registry tool definition (immutable name once registered). */
export interface ExecutableToolDefinition {
  /** Immutable after first register — use deprecated + replacedBy to rename. */
  name: string;
  version: string;
  since?: string;
  deprecated?: boolean;
  deprecatedSince?: string;
  replacedBy?: string;
  description: string;
  category: FrozenToolCategory;
  wave: 1 | 2;
  requires?: string[];
  permissions?: string[];
  risk?: ToolRisk;
  argsSchema: Record<string, ToolArgSchema>;
  examples?: string[];
  preconditions?: string[];
  observe?: string;
  /** Sole selection tiebreaker when multiple tools match — §4a.2 */
  priority?: number;
  /** Telemetry / budget only — not planner selection input */
  cost?: number;
  idempotent?: boolean;
  dependsOnTools?: string[];
  execution?: {
    timeoutMs?: number;
    retry?: number;
    maxExecutionTimeMs?: number;
  };
}

export type ResolvedEntities = Record<string, unknown>;

export interface CapabilitySnapshot {
  capturedAt: number;
  manifestVersion: string;
  registeredTools: string[];
  native: {
    sendInput: boolean;
    uia: boolean;
    ocr: boolean;
    sidecarUp: boolean;
  };
  extensions: Record<string, boolean>;
  permissions: Record<string, "granted" | "denied" | "unknown">;
}

import type { WorkflowContext } from "./workflowTypes.js";

export interface ExecutionContext {
  world: WorldModel;
  resolved: ResolvedEntities;
  capabilities: CapabilitySnapshot;
  currentApp: string | null;
  focusedWindow: ForegroundWindow | null;
  clipboard: { hasText: boolean; preview: string };
  selection: string | null;
  recentTool: string | null;
  currentFolder: string | null;
  recentFile: string | null;
  lastStepOutput: unknown;
  /** Evidence-driven Semantic workflow state (optional). */
  workflow?: WorkflowContext;
}

export interface ToolContext {
  execution: ExecutionContext;
  command: string;
  stepIndex: number;
}

export interface StepObservation {
  ok: boolean;
  reason?: string;
}

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  observation?: StepObservation;
}

export type ToolExecuteFn = (
  ctx: ToolContext,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export interface RegisteredTool {
  definition: ExecutableToolDefinition;
  execute: ToolExecuteFn;
}

export function isFrozenToolCategory(value: string): value is FrozenToolCategory {
  return (FROZEN_TOOL_CATEGORIES as readonly string[]).includes(value);
}
