import { applyWhatsAppVoiceOverride } from "../automation/adapters/whatsapp/whatsappVoiceOverride.js";
import { buildNotionCommandResult } from "../automation/adapters/notion/notionCommand.js";
import { applyNotionVoiceOverride } from "../automation/adapters/notion/notionVoiceOverride.js";
import { buildYouTubeCommandResult } from "../automation/adapters/youtube/youtubeCommand.js";
import { applyYouTubeVoiceOverride } from "../automation/adapters/youtube/youtubeVoiceOverride.js";
import { buildLinkedInCommandResult } from "../automation/adapters/linkedin/linkedinCommand.js";
import { applyLinkedInVoiceOverride } from "../automation/adapters/linkedin/linkedinVoiceOverride.js";
import { buildInstagramCommandResult } from "../automation/adapters/instagram/instagramCommand.js";
import { applyInstagramVoiceOverride } from "../automation/adapters/instagram/instagramVoiceOverride.js";
import { isInstagramTabActive } from "../focus/focusContext.js";
import { isEditOrRephraseCommand } from "../automation/commandIntent.js";
import { extractRephraseSourceText } from "../automation/rephraseParse.js";
import { resolveBackendContext } from "../automation/appDetector/contextBuilder.js";
import { buildDesktopCommandResult } from "../automation/desktop/desktopCommand.js";
import type { CommandResultPayload } from "../automation/types.js";
import { runCommandActions } from "../automation/actionRunner.js";
import { setLastCommandIntent } from "../state/lastCommand.js";
import { rippleSocket } from "../socket/rippleSocket.js";
import {
  apiExecuteCommand,
  type ApiResponse,
} from "./api.js";

export interface RunCommandInput {
  command: string;
  sessionId?: string | null;
  contextMetadata?: Record<string, unknown>;
  selectedText?: string | null;
  getAccessToken: () => Promise<string | null>;
}

export interface RunCommandResult {
  ok: boolean;
  message?: string;
  data?: CommandResultPayload & { execution?: unknown };
  usedRestFallback?: boolean;
}

async function fetchCommandResult(
  input: RunCommandInput,
): Promise<{ data: CommandResultPayload; usedRestFallback: boolean }> {
  const { contextType, actionSource } = resolveBackendContext(input.contextMetadata);

  if (rippleSocket.isConnected()) {
    try {
      const data = (await rippleSocket.executeCommand({
        command: input.command,
        sessionId: input.sessionId ?? undefined,
        contextType,
        actionSource,
        contextMetadata: input.contextMetadata,
        selectedText: input.selectedText ?? undefined,
      })) as CommandResultPayload;
      return { data, usedRestFallback: false };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Socket command failed";
      console.warn(`[ripple-desktop] socket command failed, trying REST: ${msg}`);
    }
  } else {
    console.warn("[ripple-desktop] socket offline — using REST /commands/execute");
  }

  const access = await input.getAccessToken();
  if (!access) {
    throw new Error("Not authenticated");
  }

  const res = (await apiExecuteCommand(access, {
    sessionId: input.sessionId ?? undefined,
    command: input.command,
    contextType,
    actionSource,
    contextMetadata: input.contextMetadata,
    selectedText: input.selectedText ?? undefined,
  })) as ApiResponse<Record<string, unknown>>;

  if (!res.success) {
    throw new Error(res.message);
  }

  return { data: res.data as CommandResultPayload, usedRestFallback: true };
}

async function sendActionAckSafe(ack: Parameters<typeof rippleSocket.sendActionAck>[0]) {
  if (!rippleSocket.isConnected()) return;
  try {
    await rippleSocket.sendActionAck(ack);
  } catch {
    /* desktop-only command_id may not exist in DB */
  }
}

export async function runDesktopCommand(
  input: RunCommandInput,
): Promise<RunCommandResult> {
  try {
    const desktopOnly = buildDesktopCommandResult(input.command);
    if (desktopOnly?.actions?.length && desktopOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${desktopOnly.actions.length} id=${desktopOnly.command_id} (desktop-local)`,
      );
      setLastCommandIntent(desktopOnly.intent);
      const execution = await runCommandActions(desktopOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      return { ok: true, data: { ...desktopOnly, execution } };
    }

    const notionOnly = buildNotionCommandResult(input.command);
    if (notionOnly?.actions?.length && notionOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${notionOnly.actions.length} id=${notionOnly.command_id} (notion-local)`,
      );
      setLastCommandIntent(notionOnly.intent);
      const execution = await runCommandActions(notionOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      return { ok: true, data: { ...notionOnly, execution } };
    }

    const youtubeOnly = buildYouTubeCommandResult(input.command);
    if (youtubeOnly?.actions?.length && youtubeOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${youtubeOnly.actions.length} id=${youtubeOnly.command_id} (youtube-local)`,
      );
      setLastCommandIntent(youtubeOnly.intent);
      const execution = await runCommandActions(youtubeOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      return { ok: true, data: { ...youtubeOnly, execution } };
    }

    const linkedinOnly = buildLinkedInCommandResult(input.command);
    if (linkedinOnly?.actions?.length && linkedinOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${linkedinOnly.actions.length} id=${linkedinOnly.command_id} (linkedin-local)`,
      );
      setLastCommandIntent(linkedinOnly.intent);
      const execution = await runCommandActions(linkedinOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      return { ok: true, data: { ...linkedinOnly, execution } };
    }

    const igRephrase =
      isInstagramTabActive() && isEditOrRephraseCommand(input.command);
    const instagramOnly = igRephrase
      ? null
      : buildInstagramCommandResult(input.command);
    if (instagramOnly?.actions?.length && instagramOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${instagramOnly.actions.length} id=${instagramOnly.command_id} (instagram-local)`,
      );
      setLastCommandIntent(instagramOnly.intent);
      const execution = await runCommandActions(instagramOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      return { ok: true, data: { ...instagramOnly, execution } };
    }

    let { data, usedRestFallback } = await fetchCommandResult(input);

    const notionOverride = applyNotionVoiceOverride(input.command, data);
    if (notionOverride) {
      data = notionOverride;
    }

    const youtubeOverride = applyYouTubeVoiceOverride(input.command, data);
    if (youtubeOverride) {
      data = youtubeOverride;
    }

    const waOverride = applyWhatsAppVoiceOverride(input.command, data);
    if (waOverride) {
      data = waOverride;
    }

    const linkedinOverride = applyLinkedInVoiceOverride(input.command, data);
    if (linkedinOverride) {
      data = linkedinOverride;
    }

    const instagramOverride = applyInstagramVoiceOverride(input.command, data);
    if (instagramOverride) {
      data = instagramOverride;
    }

    console.info(
      `[ripple-desktop] command:result intent=${data.intent} actions=${data.actions?.length ?? 0} id=${data.command_id}${usedRestFallback ? " (REST)" : ""}`,
    );
    setLastCommandIntent(data.intent);

    let execution = null;
    if (data.actions?.length && data.command_id) {
      console.info(
        `[ripple-desktop] running ${data.actions.length} action(s): ${data.actions.map((a) => a.type).join(", ")}`,
      );
      execution = await runCommandActions(data, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
    }

    return {
      ok: true,
      data: { ...data, execution },
      usedRestFallback,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Command failed",
    };
  }
}
