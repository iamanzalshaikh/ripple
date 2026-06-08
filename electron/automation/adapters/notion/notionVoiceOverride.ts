import type { CommandResultPayload } from "../../types.js";
import { buildNotionCommandResult } from "./notionCommand.js";
import {
  isContextualNotionVoiceCommand,
  isNotionSamePageDocCommand,
  parseNotionCommand,
} from "./parseNotionCommand.js";

function isLocalNotionWorkflow(result: CommandResultPayload): boolean {
  const action = result.actions?.[0];
  if (action?.type !== "WORKFLOW") return false;
  const steps = action.data?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const first = steps[0] as { data?: Record<string, unknown> };
  if (first?.data?._notionBatch === true) return true;
  const nested = first?.data?.data as Record<string, unknown> | undefined;
  return nested?._notionBatch === true;
}

/**
 * Backend INSERT_TEXT/generation for Notion docs on current page — do NOT override to notion.new.
 */
export function applyNotionVoiceOverride(
  command: string,
  result: CommandResultPayload,
): CommandResultPayload | null {
  if (isNotionSamePageDocCommand(command)) return null;

  const intent = parseNotionCommand(command);
  const contextual = isContextualNotionVoiceCommand(command);

  if (!intent && !contextual) return null;
  if (isLocalNotionWorkflow(result)) return null;

  const shouldOverride =
    contextual ||
    result.intent === "generation" ||
    result.intent === "edit" ||
    result.intent === "typing" ||
    result.intent === "workflow" ||
    result.actions?.some((a) => a.type === "INSERT_TEXT") ||
    result.actions?.some((a) => a.type === "NOOP") ||
    result.actions?.some((a) => a.type === "SHOW_SUGGESTIONS");

  if (!shouldOverride && intent?.kind === "open") {
    return buildNotionCommandResult(command);
  }

  if (!shouldOverride) return null;

  const local = buildNotionCommandResult(command);
  if (!local) return null;

  console.info(
    `[ripple-desktop] Notion voice override — local ${intent?.kind ?? "create_page"} (backend intent=${result.intent})`,
  );

  return local;
}
