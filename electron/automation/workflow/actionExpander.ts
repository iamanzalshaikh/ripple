import { getLastVoiceCommand } from "../../state/lastCommand.js";
import type { LocalAction } from "../localTypes.js";
import type { WorkflowStep } from "../localTypes.js";
import type { RippleAction } from "../types.js";
import {
  commandImpliesSend,
  extractContactName,
  isWhatsAppMessagingCommand,
  resolveWhatsAppMessageText,
} from "../adapters/whatsapp/parseContact.js";
import { parseReferentialWhatsApp } from "../voice/nlu/parseReferentialWhatsApp.js";
import {
  isContextualNotionVoiceCommand,
  isNotionCommand,
} from "../adapters/notion/parseNotionCommand.js";
import {
  isContextualYouTubeVoiceCommand,
  isYouTubeCommand,
} from "../adapters/youtube/parseYouTubeCommand.js";
import { isLinkedInCommand } from "../adapters/linkedin/parseLinkedInCommand.js";
import { isWhatsAppTabActive } from "../../focus/focusContext.js";
import {
  isInstagramCommand,
  parseInstagramCommand,
  resolveInstagramMessageText,
} from "../adapters/instagram/parseInstagramCommand.js";
import { isGmailVoiceCommand } from "../commandIntent.js";
import { parseNativeCommand } from "../desktop/parseNativeCommand.js";
import { desktopBatchPayload } from "../desktop/desktopCommand.js";

function isWhatsAppTarget(target: string | undefined): boolean {
  if (!target) return false;
  const t = target.toLowerCase();
  return t === "whatsapp" || t.includes("whatsapp");
}

function isGmailTarget(target: string | undefined): boolean {
  if (!target) return false;
  const t = target.toLowerCase();
  return t === "gmail" || t === "google mail";
}

function getOpenAppTarget(action: RippleAction): string | undefined {
  if (action.type !== "OPEN_APP") return undefined;
  return typeof action.data?.target === "string" ? action.data.target : undefined;
}

function getInsertText(action: RippleAction): string {
  if (action.type !== "INSERT_TEXT") return "";
  return typeof action.data?.text === "string" ? action.data.text : "";
}

/** Detect WhatsApp message workflow from voice command (search X and say/ask). */
export function isWhatsAppMessageWorkflow(steps: RippleAction[]): boolean {
  const cmd = getLastVoiceCommand() ?? "";
  if (
    isGmailVoiceCommand(cmd) ||
    isNotionCommand(cmd) ||
    isContextualNotionVoiceCommand(cmd) ||
    isYouTubeCommand(cmd) ||
    isContextualYouTubeVoiceCommand(cmd)
  ) {
    return false;
  }
  if (isWhatsAppMessagingCommand(cmd) || isWhatsAppTabActive()) {
    return true;
  }
  if (isInstagramCommand(cmd)) {
    return false;
  }

  const openWa = steps.some(
    (s) => s.type === "OPEN_APP" && isWhatsAppTarget(getOpenAppTarget(s)),
  );
  if (openWa) return true;

  const insert = steps.find((s) => s.type === "INSERT_TEXT");
  if (
    insert?.data?.recipient &&
    insert.data._whatsappBatch === true
  ) {
    return true;
  }

  if (parseReferentialWhatsApp(cmd)) return true;

  if (!isWhatsAppMessagingCommand(cmd)) return false;

  const contact = extractContactName(cmd);
  if (!contact?.trim()) return false;

  return true;
}

/**
 * Expand backend WORKFLOW into backend + local steps.
 * WhatsApp: always CDP batch (no PowerShell OPEN_APP — avoids wrong browser window).
 */
function expandInstagramWorkflow(
  cmd: string,
  steps: RippleAction[],
): WorkflowStep[] | null {
  if (isWhatsAppMessagingCommand(cmd) || isWhatsAppTabActive()) return null;
  if (steps.some((s) => s.data?._whatsappBatch === true)) return null;
  if (!isInstagramCommand(cmd)) return null;

  const intent = parseInstagramCommand(cmd);
  if (!intent || intent.kind === "open") return null;

  const insert = steps.find((s) => s.type === "INSERT_TEXT");
  const backendText = insert ? getInsertText(insert) : "";
  const text = resolveInstagramMessageText(cmd, backendText);
  if (!text.trim() && intent.kind !== "message") return null;

  const batch: Record<string, unknown> = {
    _instagramBatch: true,
    command: cmd,
  };

  if (intent.kind === "message") {
    batch.instagramKind = "message";
    batch.username = intent.username;
    batch.text = text.trim() || intent.text;
    batch.send = intent.send;
  } else {
    batch.instagramKind = "compose";
    batch.text = text.trim() || intent.text;
    batch.send = intent.send;
    batch.pasteOnly = true;
  }

  console.info(
    `[ripple-desktop] WORKFLOW expand → Instagram (${batch.instagramKind}${intent.kind === "message" ? ` user=${intent.username}` : ""})`,
  );

  return [
    {
      kind: "local",
      action: {
        type: "NOOP",
        data: batch,
      },
    },
  ];
}

/** Pre-built app batches — must run before desktop NLU expand (P5 / Tier C). */
function expandAppBatchWorkflow(steps: RippleAction[]): WorkflowStep[] | null {
  const batch = steps.find((s) => {
    if (s.type !== "NOOP" || !s.data) return false;
    return (
      s.data._linkedinBatch === true ||
      s.data._instagramBatch === true ||
      s.data._youtubeBatch === true ||
      s.data._notionBatch === true
    );
  });
  if (!batch?.data) return null;

  const data = batch.data as Record<string, unknown>;
  let label = "app";
  if (data._linkedinBatch === true) label = "LinkedIn";
  else if (data._instagramBatch === true) label = "Instagram";
  else if (data._youtubeBatch === true) label = "YouTube";
  else if (data._notionBatch === true) label = "Notion";

  console.info(`[ripple-desktop] WORKFLOW expand → ${label} (prebuilt batch)`);

  return [
    {
      kind: "local",
      action: { type: "NOOP", data },
    },
  ];
}

function expandDesktopWorkflow(cmd: string): WorkflowStep[] | null {
  if (
    isLinkedInCommand(cmd) ||
    isInstagramCommand(cmd) ||
    isYouTubeCommand(cmd) ||
    isContextualYouTubeVoiceCommand(cmd) ||
    isNotionCommand(cmd) ||
    isContextualNotionVoiceCommand(cmd)
  ) {
    return null;
  }

  const desktop = parseNativeCommand(cmd);
  if (!desktop) return null;

  if (desktop.kind === "compound") {
    console.info(
      `[ripple-desktop] WORKFLOW expand → Desktop compound (${desktop.steps.length} steps)`,
    );
    return desktop.steps.map((step) => ({
      kind: "local" as const,
      action: {
        type: "NOOP" as const,
        data: desktopBatchPayload(step, cmd),
      },
    }));
  }

  let localType: LocalAction["type"] = "OPEN_FOLDER";
  const data: Record<string, unknown> = {
    _desktopBatch: true,
    command: cmd,
  };

  switch (desktop.kind) {
    case "folder":
      localType = "OPEN_FOLDER";
      data.desktopKind = "folder";
      data.folder = desktop.folder;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (folder=${desktop.folder})`,
      );
      break;
    case "file":
      localType = "OPEN_FILE";
      data.desktopKind = "file";
      data.filename = desktop.filename;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (file=${desktop.filename})`,
      );
      break;
    case "item":
      localType = "OPEN_FILE";
      data.desktopKind = "item";
      data.itemName = desktop.name;
      if (desktop.parent) data.parentFolder = desktop.parent;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (item=${desktop.name}${desktop.parent ? `@${desktop.parent}` : ""})`,
      );
      break;
    case "smart_search":
      localType = "OPEN_FILE";
      data.desktopKind = "smart_search";
      data.smartLabel = desktop.label;
      data.smartQuery = desktop.query;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (smart=${desktop.label})`,
      );
      break;
    case "remember_life_event":
      localType = "NOOP";
      data.desktopKind = "remember_life_event";
      data.lifeEventLabel = desktop.label;
      data.lifeEventTopic = desktop.topic;
      data.lifeEventAt = desktop.eventAt;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (remember_life_event=${desktop.label})`,
      );
      break;
    case "launch_app":
      localType = "LAUNCH_APP";
      data.desktopKind = "launch_app";
      data.appId = desktop.app.id;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (launch=${desktop.app.id})`,
      );
      break;
    case "switch_app":
      localType = "FOCUS_APP";
      data.desktopKind = "switch_app";
      data.appId = desktop.app.id;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (switch=${desktop.app.id})`,
      );
      break;
    case "close_app":
      localType = "CLOSE_APP";
      data.desktopKind = "close_app";
      data.appId = desktop.app.id;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (close=${desktop.app.id})`,
      );
      break;
    case "minimize_all":
      localType = "MINIMIZE_ALL";
      data.desktopKind = "minimize_all";
      console.info("[ripple-desktop] WORKFLOW expand → Desktop (minimize_all)");
      break;
    case "system_action":
      localType = "SYSTEM_ACTION";
      data.desktopKind = "system_action";
      data.systemActionId = desktop.action;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (system=${desktop.action})`,
      );
      break;
    case "recall_memory":
      localType = "RECALL_MEMORY";
      data.desktopKind = "recall_memory";
      data.recallTarget = desktop.target;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (recall=${desktop.target})`,
      );
      break;
    case "open_alias":
      localType = "OPEN_ALIAS";
      data.desktopKind = "open_alias";
      data.aliasName = desktop.alias.name;
      data.aliasType = desktop.alias.type;
      data.aliasPath = desktop.alias.path;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (alias=${desktop.alias.name})`,
      );
      break;
    case "remember_alias":
      localType = "REMEMBER_ALIAS";
      data.desktopKind = "remember_alias";
      data.aliasName = desktop.name;
      data.aliasPath = desktop.path;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (remember=${desktop.name})`,
      );
      break;
    case "list_aliases":
      localType = "LIST_ALIASES";
      data.desktopKind = "list_aliases";
      console.info("[ripple-desktop] WORKFLOW expand → Desktop (list_aliases)");
      break;
    case "remove_alias":
      localType = "REMOVE_ALIAS";
      data.desktopKind = "remove_alias";
      data.aliasName = desktop.name;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (remove_alias=${desktop.name})`,
      );
      break;
    case "create_folder":
      localType = "CREATE_FOLDER";
      data.desktopKind = "create_folder";
      data.folderName = desktop.name;
      data.parentFolder = desktop.parent;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (create_folder=${desktop.name})`,
      );
      break;
    case "create_file":
      localType = "CREATE_FILE";
      data.desktopKind = "create_file";
      data.fileName = desktop.name;
      data.parentFolder = desktop.parent;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (create_file=${desktop.name})`,
      );
      break;
    case "rename_file":
      localType = "RENAME_FILE";
      data.desktopKind = "rename_file";
      data.sourceName = desktop.sourceName;
      data.newName = desktop.newName;
      data.parentFolder = desktop.parent;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (rename_file=${desktop.sourceName})`,
      );
      break;
    case "move_file":
      localType = "MOVE_FILE";
      data.desktopKind = "move_file";
      data.sourceName = desktop.sourceName;
      data.destinationFolder = desktop.destination;
      data.parentFolder = desktop.parent;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (move_file=${desktop.sourceName})`,
      );
      break;
    case "delete_file":
      localType = "DELETE_FILE";
      data.desktopKind = "delete_file";
      data.sourceName = desktop.sourceName;
      data.parentFolder = desktop.parent;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (delete_file=${desktop.sourceName})`,
      );
      break;
    case "referential_send":
      localType = "OPEN_FILE";
      data.desktopKind = "referential_send";
      data.contact = desktop.contact;
      data.sendMode = desktop.mode;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (referential_send=${desktop.contact})`,
      );
      break;
    case "open_workspace":
      localType = "OPEN_WORKSPACE";
      data.desktopKind = "open_workspace";
      data.workspaceId = desktop.workspace.id;
      data.workspaceUrl = desktop.workspace.url;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (workspace=${desktop.workspace.id})`,
      );
      break;
    case "remember_workspace":
      localType = "REMEMBER_WORKSPACE";
      data.desktopKind = "remember_workspace";
      data.workspaceName = desktop.name;
      data.workspaceUrl = desktop.url;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (remember_workspace=${desktop.name})`,
      );
      break;
    case "run_workflow":
      localType = "RUN_WORKFLOW";
      data.desktopKind = "run_workflow";
      data.workflowId = desktop.workflow.id;
      data.workflowSteps = desktop.workflow.steps;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (workflow=${desktop.workflow.id})`,
      );
      break;
    case "remember_workflow":
      localType = "REMEMBER_WORKFLOW";
      data.desktopKind = "remember_workflow";
      data.workflowName = desktop.name;
      data.workflowStepsRaw = desktop.stepsRaw;
      data.workflowReplace = desktop.replace === true;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (remember_workflow=${desktop.name})`,
      );
      break;
    case "list_workflows":
      localType = "LIST_WORKFLOWS";
      data.desktopKind = "list_workflows";
      console.info("[ripple-desktop] WORKFLOW expand → Desktop (list_workflows)");
      break;
    case "remove_workflow":
      localType = "REMOVE_WORKFLOW";
      data.desktopKind = "remove_workflow";
      data.workflowName = desktop.name;
      console.info(
        `[ripple-desktop] WORKFLOW expand → Desktop (remove_workflow=${desktop.name})`,
      );
      break;
  }

  return [{ kind: "local", action: { type: localType, data } }];
}

/** WhatsApp batch — NOOP or INSERT_TEXT with _whatsappBatch (whatsapp-early path). */
function expandWhatsAppBatchWorkflow(
  steps: RippleAction[],
): WorkflowStep[] | null {
  const noop = steps.find(
    (s) => s.type === "NOOP" && s.data?._whatsappBatch === true,
  );
  if (noop?.data) {
    return [
      {
        kind: "local",
        action: { type: "NOOP", data: noop.data as Record<string, unknown> },
      },
    ];
  }

  const insert = steps.find(
    (s) => s.type === "INSERT_TEXT" && s.data?._whatsappBatch === true,
  );
  if (!insert?.data) return null;

  const data = insert.data as Record<string, unknown>;
  const recipient = typeof data.recipient === "string" ? data.recipient : "";
  const text = typeof data.text === "string" ? data.text : "";
  const send = data.send === true;
  const cmd = typeof data.command === "string" ? data.command : getLastVoiceCommand() ?? "";

  if (!recipient.trim()) return null;

  console.info(
    `[ripple-desktop] WORKFLOW expand → WhatsApp (contact=${recipient}, insert batch)`,
  );

  return [
    {
      kind: "local",
      action: {
        type: "SEARCH_CONTACT",
        data: {
          text,
          recipient,
          send,
          command: cmd,
          _whatsappBatch: true,
        },
      },
    },
  ];
}

/** Use desktop batch steps already embedded in WORKFLOW payload (planner compound). */
function expandPrebuiltDesktopBatches(
  steps: RippleAction[],
): WorkflowStep[] | null {
  const batches = steps.filter(
    (s) => s.type === "NOOP" && s.data?._desktopBatch === true,
  );
  if (batches.length === 0) return null;

  if (batches.length > 1) {
    console.info(
      `[ripple-desktop] WORKFLOW expand → ${batches.length} prebuilt desktop steps`,
    );
  }

  return batches.map((s) => ({
    kind: "local" as const,
    action: {
      type: "OPEN_FILE" as const,
      data: s.data as Record<string, unknown>,
    },
  }));
}

export function expandWorkflowSteps(steps: RippleAction[]): WorkflowStep[] {
  if (steps.length === 0) return [];

  const prebuilt = expandPrebuiltDesktopBatches(steps);
  if (prebuilt) return prebuilt;

  const whatsappBatch = expandWhatsAppBatchWorkflow(steps);
  if (whatsappBatch) return whatsappBatch;

  const appBatch = expandAppBatchWorkflow(steps);
  if (appBatch) return appBatch;

  const cmd = getLastVoiceCommand() ?? "";
  const desktopSteps = expandDesktopWorkflow(cmd);
  if (desktopSteps) return desktopSteps;

  const instagramSteps = expandInstagramWorkflow(cmd, steps);
  if (instagramSteps) return instagramSteps;

  if (isWhatsAppMessageWorkflow(steps)) {
    const cmd = getLastVoiceCommand() ?? "";
    const insert = steps.find((s) => s.type === "INSERT_TEXT");
    const batchData = insert?.data as Record<string, unknown> | undefined;
    const text =
      typeof batchData?.text === "string"
        ? batchData.text
        : resolveWhatsAppMessageText(cmd, insert ? getInsertText(insert) : "");
    const contact =
      (typeof batchData?.recipient === "string" ? batchData.recipient : null) ??
      extractContactName(cmd, insert?.data?.recipient ?? extractContactName(cmd));
    const send =
      batchData?.send === true ||
      (batchData?.send !== false && commandImpliesSend(cmd));

    if (!contact?.trim()) {
      throw new Error(
        'Contact name not found. Say e.g. "search Abhishek work and write a message to good night" or "search Ammi1 and say how are you"',
      );
    }

    console.info(
      `[ripple-desktop] WORKFLOW expand → WhatsApp (contact=${contact})`,
    );

    const expanded: WorkflowStep[] = [
      {
        kind: "local",
        action: {
          type: "SEARCH_CONTACT",
          data: {
            text,
            recipient: contact,
            send,
            command: cmd,
            _whatsappBatch: true,
          },
        },
      },
    ];

    return expanded;
  }

  const optimized = optimizeGmailWorkflow(steps);
  return optimized.map((action) => ({ kind: "backend" as const, action }));
}

function optimizeGmailWorkflow(steps: RippleAction[]): RippleAction[] {
  if (steps.length < 2) return steps;
  const first = steps[0];
  const hasInsert = steps.some((s) => s.type === "INSERT_TEXT");
  if (first?.type === "OPEN_APP" && isGmailTarget(getOpenAppTarget(first)) && hasInsert) {
    console.info(
      "[ripple-desktop] WORKFLOW: skip OPEN_APP — INSERT_TEXT opens pre-filled Gmail compose",
    );
    return steps.filter((s) => s.type !== "OPEN_APP");
  }
  return steps;
}
