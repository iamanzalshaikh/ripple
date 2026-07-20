import { basename } from "node:path";
import type { WorldModel } from "../types.js";
import type {
  CapabilitySnapshot,
  ExecutionContext,
  ResolvedEntities,
} from "./toolTypes.js";
import {
  createWorkflowContext,
  type ArtifactPresentation,
  type WorkflowContext,
} from "./workflowTypes.js";

export type CreateExecutionContextInput = {
  world: WorldModel;
  resolved: ResolvedEntities;
  capabilities: CapabilitySnapshot;
  workflow?: WorkflowContext;
  intent?: string;
  command?: string;
  schemaId?: string;
  presentation?: ArtifactPresentation;
};

/** Build live execution state for a plan run (refreshed per step in Phase 2). */
export function createExecutionContext(
  input: CreateExecutionContextInput,
): ExecutionContext {
  const fg = input.world.foreground;
  const clip = input.world.clipboard;

  const projectRoot =
    typeof input.resolved.projectRoot === "string"
      ? input.resolved.projectRoot.trim()
      : "";

  const workflow =
    input.workflow ??
    (input.intent || input.schemaId
      ? createWorkflowContext({
          intent: input.intent,
          userRequest: input.command ?? "",
          schemaId: input.schemaId,
          presentation: input.presentation,
          project: projectRoot
            ? { name: basename(projectRoot), rootPath: projectRoot }
            : null,
        })
      : undefined);

  if (workflow) {
    workflow.status = "running";
    if (projectRoot && !workflow.project) {
      workflow.project = { name: basename(projectRoot), rootPath: projectRoot };
    }
  }

  return {
    world: input.world,
    resolved: input.resolved,
    capabilities: input.capabilities,
    currentApp: fg?.processName ?? null,
    focusedWindow: fg,
    clipboard: {
      hasText: clip.hasText,
      preview: clip.preview,
    },
    selection: null,
    recentTool: null,
    currentFolder: projectRoot || null,
    recentFile: null,
    lastStepOutput: undefined,
    workflow,
  };
}

/** Phase 2: refresh foreground, clipboard, selection after each tool step. */
export async function refreshExecutionContext(
  ctx: ExecutionContext,
  _world?: WorldModel,
): Promise<void> {
  void ctx;
  void _world;
  // Stub — wire win32Bridge + clipboard in Phase 2
}
