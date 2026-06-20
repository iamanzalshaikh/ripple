import type { CommandResultPayload } from "../../types.js";
import { buildLinkedInCommandResult } from "./linkedinCommand.js";
import { isLinkedInTabActive } from "../../../focus/focusContext.js";
import {
  isContextualLinkedInVoiceCommand,
  isLinkedInPostGenerationCommand,
  parseLinkedInCommand,
  wantsCreatePost,
} from "./parseLinkedInCommand.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";
import { repairCorruptedTranscript } from "../../voice/i18n/repairEncoding.js";

function isLocalLinkedInWorkflow(result: CommandResultPayload): boolean {
  const action = result.actions?.[0];
  if (action?.type !== "WORKFLOW") return false;
  const steps = action.data?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const first = steps[0] as { data?: Record<string, unknown> };
  if (first?.data?._linkedinBatch === true) return true;
  const nested = first?.data?.data as Record<string, unknown> | undefined;
  return nested?._linkedinBatch === true;
}

function extractBackendText(result: CommandResultPayload): string {
  const insert = result.actions?.find((a) => a.type === "INSERT_TEXT")?.data?.text;
  if (typeof insert === "string" && insert.trim()) return insert.trim();
  if (typeof result.result === "string" && result.result.trim()) return result.result.trim();
  return "";
}

/** Route backend-generated LinkedIn post text into the extension composer. */
export function applyLinkedInVoiceOverride(
  command: string,
  result: CommandResultPayload,
): CommandResultPayload | null {
  if (isLocalLinkedInWorkflow(result)) return null;

  const cmd = normalizeTranscript(command);
  const repaired = repairCorruptedTranscript(cmd);
  const intent =
    parseLinkedInCommand(command) ?? parseLinkedInCommand(repaired);
  const contextual =
    isContextualLinkedInVoiceCommand(command) ||
    isContextualLinkedInVoiceCommand(repaired);
  const generation =
    isLinkedInPostGenerationCommand(command) ||
    isLinkedInPostGenerationCommand(repaired);

  const onLinkedIn = isLinkedInTabActive();
  const createOnLinkedIn = onLinkedIn && wantsCreatePost(cmd);

  if (!intent && !contextual && !generation && !createOnLinkedIn) return null;

  if (intent?.kind === "search_people" || intent?.kind === "open") {
    const local =
      buildLinkedInCommandResult(command) ?? buildLinkedInCommandResult(repaired);
    if (local) {
      console.info(
        `[ripple-desktop] LinkedIn voice override — local ${intent.kind}`,
      );
      return local;
    }
  }

  const backendText = extractBackendText(result);
  const shouldOverride =
    generation ||
    contextual ||
    createOnLinkedIn ||
    result.intent === "generation" ||
    result.intent === "workflow" ||
    result.actions?.some((a) => a.type === "INSERT_TEXT");

  if (!shouldOverride && intent?.kind === "open") {
    return buildLinkedInCommandResult(command);
  }

  if (!shouldOverride) return null;

  if (generation || createOnLinkedIn || (intent?.kind === "create_post" && !intent.text)) {
    if (!backendText && !createOnLinkedIn) return null;
    const publish =
      intent?.kind === "create_post" ? intent.publish : /\b(publish|post\s+it)\b/i.test(command);

    console.info(
      `[ripple-desktop] LinkedIn voice override — create_post${backendText ? ` from backend (${backendText.length} chars)` : " (open composer)"}`,
    );

    const batchData: Record<string, unknown> = {
      _linkedinBatch: true,
      linkedinKind: "create_post",
      publish,
      command,
    };
    if (backendText) batchData.text = backendText;

    return {
      ...result,
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
                data: batchData,
              },
            ],
          },
        },
      ],
    };
  }

  const local = buildLinkedInCommandResult(command) ?? buildLinkedInCommandResult(repaired);
  if (!local) return null;

  console.info(
    `[ripple-desktop] LinkedIn voice override — local ${intent?.kind ?? "open"} (backend intent=${result.intent})`,
  );
  return local;
}
