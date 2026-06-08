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
import {
  isContextualNotionVoiceCommand,
  isNotionCommand,
} from "../adapters/notion/parseNotionCommand.js";
import {
  isContextualYouTubeVoiceCommand,
  isYouTubeCommand,
} from "../adapters/youtube/parseYouTubeCommand.js";
import {
  isInstagramCommand,
  parseInstagramCommand,
  resolveInstagramMessageText,
} from "../adapters/instagram/parseInstagramCommand.js";
import { isGmailVoiceCommand } from "../commandIntent.js";
import { parseDesktopCommand } from "../desktop/parseDesktopCommand.js";

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
    isContextualYouTubeVoiceCommand(cmd) ||
    isInstagramCommand(cmd)
  ) {
    return false;
  }

  const openWa = steps.some(
    (s) => s.type === "OPEN_APP" && isWhatsAppTarget(getOpenAppTarget(s)),
  );
  if (openWa) return true;

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

function expandDesktopWorkflow(cmd: string): WorkflowStep[] | null {
  const desktop = parseDesktopCommand(cmd);
  if (!desktop) return null;

  const localType = desktop.kind === "folder" ? "OPEN_FOLDER" : "OPEN_FILE";
  console.info(
    `[ripple-desktop] WORKFLOW expand → Desktop (${desktop.kind}=${desktop.kind === "folder" ? desktop.folder : desktop.filename})`,
  );

  return [
    {
      kind: "local",
      action: {
        type: localType,
        data: {
          _desktopBatch: true,
          desktopKind: desktop.kind,
          folder: desktop.kind === "folder" ? desktop.folder : undefined,
          filename: desktop.kind === "file" ? desktop.filename : undefined,
          command: cmd,
        },
      },
    },
  ];
}

export function expandWorkflowSteps(steps: RippleAction[]): WorkflowStep[] {
  if (steps.length === 0) return [];

  const cmd = getLastVoiceCommand() ?? "";
  const desktopSteps = expandDesktopWorkflow(cmd);
  if (desktopSteps) return desktopSteps;

  const instagramSteps = expandInstagramWorkflow(cmd, steps);
  if (instagramSteps) return instagramSteps;

  if (isWhatsAppMessageWorkflow(steps)) {
    const cmd = getLastVoiceCommand() ?? "";
    const insert = steps.find((s) => s.type === "INSERT_TEXT");
    const text = resolveWhatsAppMessageText(cmd, insert ? getInsertText(insert) : "");
    const contact = extractContactName(
      cmd,
      insert?.data?.recipient ?? extractContactName(cmd),
    );

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
            send: commandImpliesSend(cmd),
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
