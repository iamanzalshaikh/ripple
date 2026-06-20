import { applyWhatsAppVoiceOverride } from "../automation/adapters/whatsapp/whatsappVoiceOverride.js";
import { applyWhatsAppRephraseOverride } from "../automation/adapters/whatsapp/whatsappRephraseOverride.js";
import { buildNotionCommandResult } from "../automation/adapters/notion/notionCommand.js";
import { applyNotionVoiceOverride } from "../automation/adapters/notion/notionVoiceOverride.js";
import { buildYouTubeCommandResult, buildYouTubeCommandFromPlan } from "../automation/adapters/youtube/youtubeCommand.js";
import { fetchYouTubeSearchQueryFromLlm } from "../automation/adapters/youtube/youtubeSearchLlm.js";
import { isLikelyYouTubeSearchCommand } from "../automation/adapters/youtube/parseYouTubeCommand.js";
import { normalizeTranscript } from "../automation/voice/normalizeTranscript.js";
import { applyYouTubeVoiceOverride } from "../automation/adapters/youtube/youtubeVoiceOverride.js";
import { buildLinkedInCommandResult } from "../automation/adapters/linkedin/linkedinCommand.js";
import { applyLinkedInVoiceOverride } from "../automation/adapters/linkedin/linkedinVoiceOverride.js";
import { buildInstagramCommandResult } from "../automation/adapters/instagram/instagramCommand.js";
import { applyInstagramVoiceOverride } from "../automation/adapters/instagram/instagramVoiceOverride.js";
import { isInstagramTabActive, isGmailComposeFocused, isWhatsAppTabActive, isLinkedInTabActive, isYouTubeFocused } from "../focus/focusContext.js";
import { isContextualLinkedInVoiceCommand, isLinkedInCommand } from "../automation/adapters/linkedin/parseLinkedInCommand.js";
import { isContextualYouTubeVoiceCommand, isYouTubeCommand } from "../automation/adapters/youtube/parseYouTubeCommand.js";
import { looksLikeBoxDrawingMojibake } from "../automation/voice/i18n/repairEncoding.js";
import { repairCorruptedTranscript } from "../automation/voice/i18n/repairEncoding.js";
import { isEditOrRephraseCommand } from "../automation/commandIntent.js";
import { extractRephraseSourceText } from "../automation/rephraseParse.js";
import { resolveBackendContext } from "../automation/appDetector/contextBuilder.js";
import { planDesktopCommand } from "../automation/planner/planExecute.js";
import { guidedNotFound } from "../automation/planner/guidedResponses.js";
import {
  isLikelyDesktopCommand,
  isRegionalLanguageCommand,
} from "../automation/voice/nlu/desktopIntentGuard.js";
import {
  rateLimitForPayload,
  recordActionUse,
  primaryToolFromPayload,
} from "../automation/safety/actionLimiter.js";
import { buildDesktopCommandResult } from "../automation/desktop/desktopCommand.js";
import { shouldSkipFastPathForGpt } from "../automation/voice/nlu/aiFirstRouting.js";
import { parseWorkflowMetaCommand } from "../automation/desktop/parseWorkflowCommand.js";
import { isRememberWorkflowPhrase } from "../automation/desktop/spokenName.js";
import { commandPayloadFromResolvedPath } from "../automation/desktop/desktopCommand.js";
import { pickItemFromMatches } from "../automation/desktop/disambiguation.js";
import { confirmEntity, boostEntityFromOpen } from "../storage/knowledgeGraph.js";
import { setCapabilityCacheEntry } from "../storage/capabilityCache.js";
import { recordTrustSignal } from "../storage/actionTrust.js";
import { buildReferentialWhatsAppResult } from "../automation/adapters/whatsapp/buildReferentialWhatsApp.js";
import { buildWhatsAppCommandResult } from "../automation/adapters/whatsapp/whatsappCommand.js";
import { clearPreprocessCache } from "../automation/voice/nlu/preprocess.js";
import { recordCommandEvent } from "../telemetry/commandTelemetry.js";
import {
  recordConversationTurn,
  type TurnOutcome,
} from "../storage/conversationContext.js";
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

function logConversationTurn(
  command: string,
  outcome: TurnOutcome,
  extra?: { intent?: string; resolved_path?: string },
): void {
  try {
    recordConversationTurn({
      command,
      outcome,
      intent: extra?.intent ?? null,
      resolved_path: extra?.resolved_path ?? null,
    });
  } catch {
    /* local DB optional */
  }
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

function trackActionUse(payload: CommandResultPayload): void {
  try {
    recordActionUse(primaryToolFromPayload(payload));
  } catch {
    /* optional */
  }
}

function rateLimited(payload: CommandResultPayload): string | null {
  return rateLimitForPayload(payload);
}

async function tryYouTubeLocal(
  input: RunCommandInput,
): Promise<CommandResultPayload | null> {
  const normalized = normalizeTranscript(input.command);
  const repaired = repairCorruptedTranscript(input.command);

  if (isLikelyYouTubeSearchCommand(normalized) || isLikelyYouTubeSearchCommand(repaired)) {
    const access = await input.getAccessToken();
    if (access) {
      const forLlm =
        repaired !== normalized && repaired.length > 2
          ? `${repaired}\n(raw transcript: ${input.command.trim()})`
          : normalized;
      const llm = await fetchYouTubeSearchQueryFromLlm(access, forLlm);
      if (llm?.query) {
        return buildYouTubeCommandFromPlan(llm, input.command);
      }
    }
  }

  return (
    buildYouTubeCommandResult(normalized) ??
    buildYouTubeCommandResult(repaired)
  );
}

function tryLinkedInLocal(command: string): CommandResultPayload | null {
  return (
    buildLinkedInCommandResult(command) ??
    buildLinkedInCommandResult(repairCorruptedTranscript(command))
  );
}

function shouldRouteToBackendFirst(input: RunCommandInput): boolean {
  if (isGmailComposeFocused()) return true;
  if (isLinkedInTabActive()) {
    if (isLinkedInCommand(input.command)) return true;
    if (isContextualLinkedInVoiceCommand(input.command)) return true;
    if (isRegionalLanguageCommand(input.command)) return true;
    if (looksLikeBoxDrawingMojibake(input.command)) return true;
  }
  if (isYouTubeFocused()) {
    if (isYouTubeCommand(input.command)) return true;
    if (isContextualYouTubeVoiceCommand(input.command)) return true;
    if (isRegionalLanguageCommand(input.command)) return true;
    if (looksLikeBoxDrawingMojibake(input.command)) return true;
  }
  if (isWhatsAppTabActive()) {
    if (isEditOrRephraseCommand(input.command)) return true;
    if (isRegionalLanguageCommand(input.command)) return true;
  }
  if (isInstagramTabActive() && isEditOrRephraseCommand(input.command)) {
    return true;
  }
  return false;
}

async function runBackendCommandFlow(
  input: RunCommandInput,
): Promise<RunCommandResult> {
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

  const waRephrase = applyWhatsAppRephraseOverride(input.command, data);
  if (waRephrase) {
    data = waRephrase;
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

  logConversationTurn(input.command, "success", { intent: data.intent });
  return {
    ok: true,
    data: { ...data, execution },
    usedRestFallback,
  };
}

export async function runDesktopCommand(
  input: RunCommandInput,
): Promise<RunCommandResult> {
  try {
    clearPreprocessCache();

    const referentialWa = buildReferentialWhatsAppResult(input.command);
    if (referentialWa?.actions?.length && referentialWa.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow (referential-whatsapp) id=${referentialWa.command_id}`,
      );
      setLastCommandIntent(referentialWa.intent);
      const execution = await runCommandActions(referentialWa, sendActionAckSafe);
      logConversationTurn(input.command, "success", { intent: referentialWa.intent });
      return { ok: true, data: { ...referentialWa, execution } };
    }

    const linkedinEarly = tryLinkedInLocal(input.command);
    if (linkedinEarly?.actions?.length && linkedinEarly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${linkedinEarly.actions.length} id=${linkedinEarly.command_id} (linkedin-local)`,
      );
      setLastCommandIntent(linkedinEarly.intent);
      const execution = await runCommandActions(linkedinEarly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      return { ok: true, data: { ...linkedinEarly, execution } };
    }

    if (isWhatsAppTabActive() && !isLikelyDesktopCommand(input.command)) {
      const waEarly =
        buildWhatsAppCommandResult(input.command) ??
        buildWhatsAppCommandResult(repairCorruptedTranscript(input.command));
      if (waEarly?.actions?.length && waEarly.command_id) {
        console.info(
          `[ripple-desktop] command:result intent=workflow actions=${waEarly.actions.length} id=${waEarly.command_id} (whatsapp-early)`,
        );
        setLastCommandIntent(waEarly.intent);
        const execution = await runCommandActions(waEarly, sendActionAckSafe);
        if (execution) {
          const ok = execution.records.filter((r) => r.status === "executed").length;
          console.info(
            `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
          );
        }
        logConversationTurn(input.command, "success", { intent: waEarly.intent });
        return { ok: true, data: { ...waEarly, execution } };
      }
    }

    if (/\bwhatsapp\b/i.test(input.command)) {
      const waMention =
        buildWhatsAppCommandResult(input.command) ??
        buildWhatsAppCommandResult(repairCorruptedTranscript(input.command));
      if (waMention?.actions?.length && waMention.command_id) {
        console.info(
          `[ripple-desktop] command:result intent=workflow actions=${waMention.actions.length} id=${waMention.command_id} (whatsapp-mention)`,
        );
        setLastCommandIntent(waMention.intent);
        const execution = await runCommandActions(waMention, sendActionAckSafe);
        if (execution) {
          const ok = execution.records.filter((r) => r.status === "executed").length;
          console.info(
            `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
          );
        }
        logConversationTurn(input.command, "success", { intent: waMention.intent });
        return { ok: true, data: { ...waMention, execution } };
      }
    }

    const cmdNorm = normalizeTranscript(input.command);
    const isWorkflowTeach =
      /^\s*(?:remember|replace)\s+/i.test(cmdNorm) &&
      (Boolean(parseWorkflowMetaCommand(cmdNorm)) ||
        isRememberWorkflowPhrase(cmdNorm));

    if (!isWorkflowTeach) {
      const youtubeEarly = await tryYouTubeLocal(input);
      if (youtubeEarly?.actions?.length && youtubeEarly.command_id) {
        console.info(
          `[ripple-desktop] command:result intent=workflow actions=${youtubeEarly.actions.length} id=${youtubeEarly.command_id} (youtube-local)`,
        );
        setLastCommandIntent(youtubeEarly.intent);
        const execution = await runCommandActions(youtubeEarly, sendActionAckSafe);
        if (execution) {
          const ok = execution.records.filter((r) => r.status === "executed").length;
          console.info(
            `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
          );
        }
        return { ok: true, data: { ...youtubeEarly, execution } };
      }
    }

    const desktopFast = buildDesktopCommandResult(input.command);
    if (
      desktopFast?.actions?.length &&
      desktopFast.command_id &&
      !shouldSkipFastPathForGpt(input.command)
    ) {
      const limited = rateLimited(desktopFast);
      if (limited) {
        recordCommandEvent({
          command: input.command,
          outcome: "blocked",
          detail: "rate_limit",
        });
        return { ok: false, message: limited };
      }
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${desktopFast.actions?.length ?? 0} id=${desktopFast.command_id} (desktop-fast)`,
      );
      setLastCommandIntent(desktopFast.intent);
      const execution = await runCommandActions(desktopFast, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
        recordCommandEvent({
          command: input.command,
          outcome: ok > 0 ? "success" : "error",
          planner_source: "fast",
          intent: desktopFast.intent,
        });
      }
      logConversationTurn(input.command, "success", { intent: desktopFast.intent });
      trackActionUse(desktopFast);
      return { ok: true, data: { ...desktopFast, execution } };
    }

    const whatsappOnly = buildWhatsAppCommandResult(input.command);
    if (whatsappOnly?.actions?.length && whatsappOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${whatsappOnly.actions.length} id=${whatsappOnly.command_id} (whatsapp-local)`,
      );
      setLastCommandIntent(whatsappOnly.intent);
      const execution = await runCommandActions(whatsappOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      return { ok: true, data: { ...whatsappOnly, execution } };
    }

    if (shouldRouteToBackendFirst(input)) {
      console.info(
        "[ripple-desktop] web-app compose — backend-first (skip desktop planner)",
      );
      return runBackendCommandFlow(input);
    }

    const planStarted = Date.now();

    const planned = await planDesktopCommand(input.command, input.getAccessToken);
    const planLatencyMs = Date.now() - planStarted;

    if (!planned) {
      if (shouldRouteToBackendFirst(input)) {
        return runBackendCommandFlow(input);
      }
      if (
        isLikelyDesktopCommand(input.command) ||
        isRegionalLanguageCommand(input.command)
      ) {
        const message = guidedNotFound(input.command);
        recordCommandEvent({
          command: input.command,
          outcome: "not_found",
          planner_source: "offline",
          detail: "plan_null",
          latency_ms: planLatencyMs,
        });
        logConversationTurn(input.command, "not_found");
        return { ok: false, message };
      }
    }

    if (planned?.kind === "payload") {
      const limited = rateLimited(planned.payload);
      if (limited) {
        recordCommandEvent({
          command: input.command,
          outcome: "blocked",
          detail: "rate_limit",
          latency_ms: planLatencyMs,
        });
        return { ok: false, message: limited };
      }
      const desktopOnly = planned.payload;
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${desktopOnly.actions?.length ?? 0} id=${desktopOnly.command_id} (desktop-${planned.source})`,
      );
      setLastCommandIntent(desktopOnly.intent);
      const execution = await runCommandActions(desktopOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
        recordCommandEvent({
          command: input.command,
          outcome: ok > 0 ? "success" : "error",
          planner_source: planned.source,
          confidence: planned.confidence,
          intent: desktopOnly.intent,
          latency_ms: planLatencyMs,
        });
      }
      logConversationTurn(input.command, "success", {
        intent: desktopOnly.intent,
      });
      trackActionUse(desktopOnly);
      return { ok: true, data: { ...desktopOnly, execution } };
    }

    if (
      planned?.kind === "blocked" ||
      planned?.kind === "rephrase" ||
      planned?.kind === "not_found"
    ) {
      const message =
        planned.kind === "blocked" ? planned.message : planned.hint;
      const outcome =
        planned.kind === "blocked"
          ? "blocked"
          : planned.kind === "not_found"
            ? "not_found"
            : "rephrase";
      if (planned.kind === "not_found" && shouldRouteToBackendFirst(input)) {
        return runBackendCommandFlow(input);
      }
      recordCommandEvent({
        command: input.command,
        outcome,
        planner_source: planned.kind === "not_found" ? "gpt" : "offline",
        detail: planned.kind,
        latency_ms: planLatencyMs,
      });
      console.warn(`[ripple-desktop] desktop plan ${planned.kind}: ${message}`);
      logConversationTurn(input.command, outcome);
      return { ok: false, message };
    }

    if (planned?.kind === "clarify") {
      if (planned.candidates.length > 0) {
        const paths = planned.candidates.map((c) => c.path);
        const picked = await pickItemFromMatches(
          planned.question,
          paths,
        );
        if (picked) {
          const key = input.command.match(/\bopen\s+(?:my\s+|the\s+)?(.+?)\s*$/i)?.[1]
            ?.trim()
            .toLowerCase();
          if (key) {
            setCapabilityCacheEntry(key, picked, 0.95);
            recordTrustSignal(key, "clarify");
            boostEntityFromOpen(key, picked);
            confirmEntity(key);
          }
          const payload = commandPayloadFromResolvedPath(
            input.command,
            picked,
            " (clarify)",
          );
          setLastCommandIntent(payload.intent);
          const execution = await runCommandActions(payload, sendActionAckSafe);
          recordCommandEvent({
            command: input.command,
            outcome: "success",
            planner_source: "offline",
            confidence: planned.confidence,
            intent: payload.intent,
            latency_ms: planLatencyMs,
          });
          trackActionUse(payload);
          return { ok: true, data: { ...payload, execution } };
        }
        recordCommandEvent({
          command: input.command,
          outcome: "cancel",
          detail: "clarify_dismissed",
          latency_ms: planLatencyMs,
        });
        return { ok: false, message: "Cancelled — pick which file you meant" };
      }
      return {
        ok: false,
        message: planned.question,
      };
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

    const youtubeOnly = await tryYouTubeLocal(input);
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

    const linkedinOnly = tryLinkedInLocal(input.command);
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

    return runBackendCommandFlow(input);
  } catch (e: unknown) {
    logConversationTurn(input.command, "error");
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Command failed",
    };
  }
}
