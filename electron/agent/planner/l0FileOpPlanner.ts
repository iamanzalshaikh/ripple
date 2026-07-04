import type { FileOpIntent } from "../../automation/desktop/parseFileOperationCommand.js";
import type { DesktopOpenIntent } from "../../automation/desktop/parseDesktopCommand.js";
import type { ExecutionPlan, PlanStep } from "./planTypes.js";

const DEFAULT_PARENT = "desktop";

function parentArg(parent?: string): { parentFolder: string } {
  return { parentFolder: parent ?? DEFAULT_PARENT };
}

export function isFileOpIntent(
  intent: { kind: string },
): intent is FileOpIntent {
  return (
    intent.kind === "create_folder" ||
    intent.kind === "create_file" ||
    intent.kind === "rename_file" ||
    intent.kind === "move_file" ||
    intent.kind === "delete_file"
  );
}

export function isDesktopOpenIntent(
  intent: { kind: string },
): intent is DesktopOpenIntent {
  return (
    intent.kind === "folder" ||
    intent.kind === "file" ||
    intent.kind === "item"
  );
}

export function fileOpIntentToPlanSteps(intent: FileOpIntent): PlanStep[] {
  switch (intent.kind) {
    case "delete_file":
      return [
        {
          tool: "filesystem.delete",
          args: {
            sourceName: intent.sourceName,
            ...parentArg(intent.parent),
          },
          reason: "delete_file",
        },
      ];
    case "create_file":
      return [
        {
          tool: "filesystem.create",
          args: {
            fileName: intent.name,
            ...parentArg(intent.parent),
          },
          reason: "create_file",
        },
      ];
    case "create_folder":
      return [
        {
          tool: "filesystem.create_folder",
          args: {
            folderName: intent.name,
            ...parentArg(intent.parent),
          },
          reason: "create_folder",
        },
      ];
    case "rename_file":
      return [
        {
          tool: "filesystem.rename",
          args: {
            sourceName: intent.sourceName,
            newName: intent.newName,
            ...parentArg(intent.parent),
          },
          reason: "rename_file",
        },
      ];
    case "move_file":
      return [
        {
          tool: "filesystem.move",
          args: {
            sourceName: intent.sourceName,
            destinationFolder: intent.destination,
            ...parentArg(intent.parent),
          },
          reason: "move_file",
        },
      ];
    default:
      return [];
  }
}

export function openIntentToPlanSteps(intent: DesktopOpenIntent): PlanStep[] {
  switch (intent.kind) {
    case "folder":
      return [
        {
          tool: "filesystem.open",
          args: { folder: intent.folder },
          reason: "open_folder",
        },
      ];
    case "file":
      return [
        {
          tool: "filesystem.open",
          args: { fileName: intent.filename },
          reason: "open_file",
        },
      ];
    case "item":
      return [
        {
          tool: "filesystem.open",
          args: {
            itemName: intent.name,
            ...(intent.parent ? { parentFolder: intent.parent } : {}),
          },
          reason: "open_item",
        },
      ];
    default:
      return [];
  }
}

function fileOpGoal(intent: FileOpIntent): string {
  switch (intent.kind) {
    case "delete_file":
      return `Delete ${intent.sourceName}`;
    case "create_file":
      return `Create file ${intent.name}`;
    case "create_folder":
      return `Create folder ${intent.name}`;
    case "rename_file":
      return `Rename ${intent.sourceName} to ${intent.newName}`;
    case "move_file":
      return `Move ${intent.sourceName} to ${intent.destination}`;
    default:
      return "File operation";
  }
}

function openGoal(intent: DesktopOpenIntent): string {
  switch (intent.kind) {
    case "folder":
      return `Open ${intent.folder}`;
    case "file":
      return `Open ${intent.filename}`;
    case "item":
      return `Open ${intent.name}`;
    default:
      return "Open item";
  }
}

export function planFromFileOpIntent(
  intent: FileOpIntent,
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal: fileOpGoal(intent),
    confidence: 0.9,
    steps: fileOpIntentToPlanSteps(intent),
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

export function planFromOpenIntent(
  intent: DesktopOpenIntent,
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal: openGoal(intent),
    confidence: 0.9,
    steps: openIntentToPlanSteps(intent),
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}
