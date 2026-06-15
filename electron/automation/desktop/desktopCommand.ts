import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../types.js";
import { parseNativeCommand } from "./parseNativeCommand.js";
import type { NativeCommandIntent } from "./parseNativeCommand.js";

function intentLabel(intent: NativeCommandIntent): string {
  switch (intent.kind) {
    case "folder":
      return `folder:${intent.folder}`;
    case "file":
      return `file:${intent.filename}`;
    case "item":
      return intent.parent
        ? `item:${intent.name}@${intent.parent}`
        : `item:${intent.name}`;
    case "launch_app":
      return `launch:${intent.app.id}`;
    case "switch_app":
      return `switch:${intent.app.id}`;
    case "close_app":
      return `close:${intent.app.id}`;
    case "minimize_all":
      return "minimize_all";
    case "system_action":
      return `system:${intent.action}`;
    case "recall_memory":
      return `recall:${intent.target}`;
    case "open_alias":
      return `alias:${intent.alias.name}`;
    case "remember_alias":
      return `remember:${intent.name}`;
    case "list_aliases":
      return "list_aliases";
    case "remove_alias":
      return `remove_alias:${intent.name}`;
    case "create_folder":
      return `create_folder:${intent.name}`;
    case "create_file":
      return `create_file:${intent.name}`;
    case "rename_file":
      return `rename_file:${intent.sourceName}`;
    case "move_file":
      return `move_file:${intent.sourceName}`;
    case "delete_file":
      return `delete_file:${intent.sourceName}`;
    case "open_workspace":
      return `workspace:${intent.workspace.id}`;
    case "remember_workspace":
      return `remember_workspace:${intent.name}`;
    case "run_workflow":
      return `workflow:${intent.workflow.id}`;
    case "remember_workflow":
      return `remember_workflow:${intent.name}`;
    case "list_workflows":
      return "list_workflows";
    case "remove_workflow":
      return `remove_workflow:${intent.name}`;
  }
}

function batchPayload(
  intent: NativeCommandIntent,
  command: string,
): Record<string, unknown> {
  const base = { _desktopBatch: true, command };

  switch (intent.kind) {
    case "folder":
      return { ...base, desktopKind: "folder", folder: intent.folder };
    case "file":
      return { ...base, desktopKind: "file", filename: intent.filename };
    case "item":
      return {
        ...base,
        desktopKind: "item",
        itemName: intent.name,
        parentFolder: intent.parent,
      };
    case "launch_app":
      return {
        ...base,
        desktopKind: "launch_app",
        appId: intent.app.id,
        appLaunch: intent.app.launch,
      };
    case "switch_app":
      return { ...base, desktopKind: "switch_app", appId: intent.app.id };
    case "close_app":
      return { ...base, desktopKind: "close_app", appId: intent.app.id };
    case "minimize_all":
      return { ...base, desktopKind: "minimize_all" };
    case "system_action":
      return {
        ...base,
        desktopKind: "system_action",
        systemActionId: intent.action,
      };
    case "recall_memory":
      return {
        ...base,
        desktopKind: "recall_memory",
        recallTarget: intent.target,
      };
    case "open_alias":
      return {
        ...base,
        desktopKind: "open_alias",
        aliasName: intent.alias.name,
        aliasType: intent.alias.type,
        aliasPath: intent.alias.path,
      };
    case "remember_alias":
      return {
        ...base,
        desktopKind: "remember_alias",
        aliasName: intent.name,
        aliasPath: intent.path,
      };
    case "list_aliases":
      return { ...base, desktopKind: "list_aliases" };
    case "remove_alias":
      return {
        ...base,
        desktopKind: "remove_alias",
        aliasName: intent.name,
      };
    case "create_folder":
      return {
        ...base,
        desktopKind: "create_folder",
        folderName: intent.name,
        parentFolder: intent.parent,
      };
    case "create_file":
      return {
        ...base,
        desktopKind: "create_file",
        fileName: intent.name,
        parentFolder: intent.parent,
      };
    case "rename_file":
      return {
        ...base,
        desktopKind: "rename_file",
        sourceName: intent.sourceName,
        newName: intent.newName,
        parentFolder: intent.parent,
      };
    case "move_file":
      return {
        ...base,
        desktopKind: "move_file",
        sourceName: intent.sourceName,
        destinationFolder: intent.destination,
        parentFolder: intent.parent,
      };
    case "delete_file":
      return {
        ...base,
        desktopKind: "delete_file",
        sourceName: intent.sourceName,
        parentFolder: intent.parent,
      };
    case "open_workspace":
      return {
        ...base,
        desktopKind: "open_workspace",
        workspaceId: intent.workspace.id,
        workspaceUrl: intent.workspace.url,
      };
    case "remember_workspace":
      return {
        ...base,
        desktopKind: "remember_workspace",
        workspaceName: intent.name,
        workspaceUrl: intent.url,
      };
    case "run_workflow":
      return {
        ...base,
        desktopKind: "run_workflow",
        workflowId: intent.workflow.id,
        workflowSteps: intent.workflow.steps,
      };
    case "remember_workflow":
      return {
        ...base,
        desktopKind: "remember_workflow",
        workflowName: intent.name,
        workflowStepsRaw: intent.stepsRaw,
      };
    case "list_workflows":
      return { ...base, desktopKind: "list_workflows" };
    case "remove_workflow":
      return {
        ...base,
        desktopKind: "remove_workflow",
        workflowName: intent.name,
      };
  }
}

/** Build a local WORKFLOW for desktop actions (no backend LLM required). */
export function buildDesktopCommandResult(
  command: string,
): CommandResultPayload | null {
  const intent = parseNativeCommand(command);
  if (!intent) return null;

  console.info(`[ripple-desktop] you said: "${command.trim()}"`);
  console.info(`[ripple-desktop] desktop intent: ${intentLabel(intent)}`);

  return {
    command_id: randomUUID(),
    intent: "workflow",
    output_type: "workflow",
    actions: [
      {
        type: "WORKFLOW",
        status: "pending",
        data: {
          steps: [
            {
              type: "NOOP",
              status: "pending",
              data: batchPayload(intent, command),
            },
          ],
        },
      },
    ],
  };
}
