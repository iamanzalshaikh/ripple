import type { WorldModel } from "../types.js";
import type {
  CapabilitySnapshot,
  ExecutionContext,
  ResolvedEntities,
} from "./toolTypes.js";

export type CreateExecutionContextInput = {
  world: WorldModel;
  resolved: ResolvedEntities;
  capabilities: CapabilitySnapshot;
};

/** Build live execution state for a plan run (refreshed per step in Phase 2). */
export function createExecutionContext(
  input: CreateExecutionContextInput,
): ExecutionContext {
  const fg = input.world.foreground;
  const clip = input.world.clipboard;

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
    currentFolder: null,
    recentFile: null,
    lastStepOutput: undefined,
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
