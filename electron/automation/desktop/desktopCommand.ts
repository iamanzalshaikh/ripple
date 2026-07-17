import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../types.js";
import { parseDesktopIntent } from "../voice/nlu/pipeline.js";
import type { CompoundIntent } from "../voice/nlu/compoundParse.js";
import type { NativeCommandIntent } from "./parseNativeCommand.js";
import { resolveKnownItemPath } from "./openDesktopItem.js";
import { buildTypingPayloadFromTypeIntent, insertTextDataFromTypeIntent } from "../../agent/typingPayload.js";

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
    case "smart_search":
      return `smart:${intent.label}`;
    case "undo_last":
      return "undo_last";
    case "open_resolved":
      return `resolved:${intent.path}`;
    case "referential_send":
      return `referential_send:${intent.contact}`;
    case "compound":
      return `compound:${intent.label}`;
    case "remember_life_event":
      return `remember_life_event:${intent.label}`;
    case "open_gmail_email":
      return intent.attachmentQuery
        ? `gmail_attachment:${intent.attachmentQuery}`
        : intent.subjectQuery
          ? `gmail_subject:${intent.subjectQuery}`
          : `gmail_email:${intent.senderQuery ?? ""}`;
    case "open_cross_app_attachment":
      return `cross_app_attachment:${intent.extension ?? "file"}:${intent.contact ?? intent.phrase}`;
    case "type_text":
      return intent.text
        ? `type_text:${intent.text.slice(0, 40)}`
        : intent.keys
          ? `type_keys:${intent.keys}`
          : "type_sequence";
  }
}

/** Batch payload for runDesktopOpenBatch — shared with actionExpander compound steps. */
export function desktopBatchPayload(
  intent: Exclude<NativeCommandIntent, CompoundIntent>,
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
        workflowVersion: intent.workflow.version,
      };
    case "remember_workflow":
      return {
        ...base,
        desktopKind: "remember_workflow",
        workflowName: intent.name,
        workflowStepsRaw: intent.stepsRaw,
        workflowReplace: intent.replace === true,
      };
    case "list_workflows":
      return { ...base, desktopKind: "list_workflows" };
    case "remove_workflow":
      return {
        ...base,
        desktopKind: "remove_workflow",
        workflowName: intent.name,
      };
    case "smart_search":
      return {
        ...base,
        desktopKind: "smart_search",
        smartLabel: intent.label,
        smartQuery: intent.query,
      };
    case "undo_last":
      return { ...base, desktopKind: "undo_last" };
    case "open_resolved":
      return {
        ...base,
        desktopKind: "open_resolved",
        resolvedPath: intent.path,
      };
    case "referential_send":
      return {
        ...base,
        desktopKind: "referential_send",
        contact: intent.contact,
        sendMode: intent.mode,
      };
    case "remember_life_event":
      return {
        ...base,
        desktopKind: "remember_life_event",
        lifeEventLabel: intent.label,
        lifeEventTopic: intent.topic,
        lifeEventAt: intent.eventAt,
      };
    case "open_gmail_email":
      return {
        ...base,
        desktopKind: "open_gmail_email",
        gmailSenderQuery: intent.senderQuery,
        gmailSubjectQuery: intent.subjectQuery,
        gmailAttachmentQuery: intent.attachmentQuery,
      };
    case "open_cross_app_attachment":
      return {
        ...base,
        desktopKind: "open_cross_app_attachment",
        crossAppAttachmentPhrase: intent.phrase,
        crossAppAttachmentExt: intent.extension,
        crossAppAttachmentContact: intent.contact,
      };
    case "type_text":
      return {
        ...base,
        desktopKind: "type_text",
        ...insertTextDataFromTypeIntent(intent),
      };
  }
}

/** Build a local WORKFLOW for desktop actions (no backend LLM required). */
export function buildDesktopCommandResult(
  command: string,
): CommandResultPayload | null {
  const parsed = parseDesktopIntent(command);
  if (!parsed) return null;
  return payloadFromIntent(parsed.intent, command, parsed.viaNlu ? " (NLU)" : "");
}

/** Build workflow payload from a resolved native intent (used by planExecute). */
export function commandPayloadFromIntent(
  intent: NativeCommandIntent,
  command: string,
  tag: string,
): CommandResultPayload {
  return payloadFromIntent(intent, command, tag);
}

/** Build workflow payload from a grounded file/folder path (retriever / cache). */
export function commandPayloadFromResolvedPath(
  command: string,
  path: string,
  tag: string,
): CommandResultPayload {
  return commandPayloadFromIntent(
    { kind: "open_resolved", path },
    command,
    tag,
  );
}

/** Build compound WORKFLOW steps; chain resolved paths into referential send batches. */
function compoundStepsToWorkflowPayload(
  steps: NativeCommandIntent[],
  command: string,
): Array<{ type: "NOOP"; status: "pending"; data: Record<string, unknown> }> {
  let chainedPath: string | undefined;

  return steps.map((step, i) => {
    if (step.kind === "type_text") {
      return {
        type: "INSERT_TEXT" as const,
        status: "pending" as const,
        data: insertTextDataFromTypeIntent(step),
      };
    }

    const batch = desktopBatchPayload(
      step as Exclude<NativeCommandIntent, CompoundIntent>,
      `${command.trim()} [${i + 1}/${steps.length}]`,
    );

    if (step.kind === "item" && step.parent) {
      chainedPath =
        resolveKnownItemPath(step.name, step.parent) ?? chainedPath;
    } else if (step.kind === "open_resolved") {
      chainedPath = step.path;
    } else if (step.kind === "smart_search") {
      chainedPath = undefined;
    }

    if (step.kind === "referential_send" && chainedPath) {
      batch.sourcePath = chainedPath;
    }

    return {
      type: "NOOP" as const,
      status: "pending" as const,
      data: batch,
    };
  });
}

function payloadFromIntent(
  intent: NativeCommandIntent,
  command: string,
  tag: string,
): CommandResultPayload {
  console.info(`[ripple-desktop] you said: "${command.trim()}"`);
  console.info(`[ripple-desktop] desktop intent: ${intentLabel(intent)}${tag}`);

  if (intent.kind === "type_text") {
    return buildTypingPayloadFromTypeIntent(command, intent);
  }

  if (intent.kind === "compound") {
    return {
      command_id: randomUUID(),
      intent: "workflow",
      output_type: "workflow",
      actions: [
        {
          type: "WORKFLOW",
          status: "pending",
          data: {
            steps: compoundStepsToWorkflowPayload(intent.steps, command),
          },
        },
      ],
    };
  }

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
              data: desktopBatchPayload(intent, command),
            },
          ],
        },
      },
    ],
  };
}
