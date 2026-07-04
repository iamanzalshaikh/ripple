import type { CommandResultPayload } from "../../automation/types.js";
import type { ExecutionPlan, PlanStep } from "./planTypes.js";

const FILE_MUTATOR_KINDS = new Set([
  "delete_file",
  "create_file",
  "create_folder",
  "rename_file",
  "move_file",
]);

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function desktopKindToFilesystemStep(
  data: Record<string, unknown>,
): PlanStep | null {
  const kind = str(data, "desktopKind");
  if (!kind || !FILE_MUTATOR_KINDS.has(kind)) return null;

  switch (kind) {
    case "delete_file":
      return {
        tool: "filesystem.delete",
        args: {
          sourceName: str(data, "sourceName") ?? "",
          ...(str(data, "parentFolder")
            ? { parentFolder: str(data, "parentFolder") }
            : {}),
        },
        reason: "delete_file",
      };
    case "create_file":
      return {
        tool: "filesystem.create",
        args: {
          fileName: str(data, "fileName") ?? "",
          parentFolder: str(data, "parentFolder") ?? "desktop",
        },
        reason: "create_file",
      };
    case "create_folder":
      return {
        tool: "filesystem.create_folder",
        args: {
          folderName: str(data, "folderName") ?? "",
          parentFolder: str(data, "parentFolder") ?? "desktop",
        },
        reason: "create_folder",
      };
    case "rename_file":
      return {
        tool: "filesystem.rename",
        args: {
          sourceName: str(data, "sourceName") ?? "",
          newName: str(data, "newName") ?? "",
          ...(str(data, "parentFolder")
            ? { parentFolder: str(data, "parentFolder") }
            : {}),
        },
        reason: "rename_file",
      };
    case "move_file":
      return {
        tool: "filesystem.move",
        args: {
          sourceName: str(data, "sourceName") ?? "",
          destinationFolder: str(data, "destinationFolder") ?? "",
          ...(str(data, "parentFolder")
            ? { parentFolder: str(data, "parentFolder") }
            : {}),
        },
        reason: "move_file",
      };
    default:
      return null;
  }
}

function workflowBatchSteps(payload: CommandResultPayload): PlanStep[] {
  const out: PlanStep[] = [];
  for (const action of payload.actions ?? []) {
    if (action.type !== "WORKFLOW") continue;
    const steps =
      (
        action.data as {
          steps?: Array<{ type: string; data?: Record<string, unknown> }>;
        }
      )?.steps ?? [];
    for (const step of steps) {
      if (step.type !== "NOOP" || !step.data) continue;
      const mapped = desktopKindToFilesystemStep(step.data);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

/**
 * When NLU returns a single file-mutator WORKFLOW, emit filesystem tool steps
 * instead of routing through desktop.launch_app + _desktopPayload.
 */
export function filesystemPlanFromDesktopPayload(
  payload: CommandResultPayload,
  rawCommand: string,
  normalized: string,
): ExecutionPlan | null {
  const steps = workflowBatchSteps(payload);
  if (steps.length !== 1) return null;

  const only = steps[0]!;
  if (only.tool === "filesystem.delete" && !only.args.sourceName) return null;
  if (only.tool === "filesystem.create" && !only.args.fileName) return null;
  if (only.tool === "filesystem.create_folder" && !only.args.folderName) {
    return null;
  }
  if (
    only.tool === "filesystem.rename" &&
    (!only.args.sourceName || !only.args.newName)
  ) {
    return null;
  }
  if (
    only.tool === "filesystem.move" &&
    (!only.args.sourceName || !only.args.destinationFolder)
  ) {
    return null;
  }

  return {
    goal: "File operation",
    confidence: 0.88,
    steps,
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}
