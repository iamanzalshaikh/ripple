import type { CommandResultPayload } from "../../types.js";
import { buildYouTubeCommandResult } from "./youtubeCommand.js";
import {
  isContextualYouTubeVoiceCommand,
  parseYouTubeCommand,
} from "./parseYouTubeCommand.js";

function isLocalYouTubeWorkflow(result: CommandResultPayload): boolean {
  const action = result.actions?.[0];
  if (action?.type !== "WORKFLOW") return false;
  const steps = action.data?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const first = steps[0] as { data?: Record<string, unknown> };
  if (first?.data?._youtubeBatch === true) return true;
  const nested = first?.data?.data as Record<string, unknown> | undefined;
  return nested?._youtubeBatch === true;
}

/** Replace backend INSERT_TEXT/generation with local YouTube search URL. */
export function applyYouTubeVoiceOverride(
  command: string,
  result: CommandResultPayload,
): CommandResultPayload | null {
  const intent = parseYouTubeCommand(command);
  const contextual = isContextualYouTubeVoiceCommand(command);

  if (!intent && !contextual) return null;
  if (isLocalYouTubeWorkflow(result)) return null;

  const shouldOverride =
    contextual ||
    result.intent === "navigation" ||
    result.intent === "generation" ||
    result.intent === "edit" ||
    result.intent === "typing" ||
    result.intent === "workflow" ||
    result.actions?.some((a) => a.type === "OPEN_APP" || a.type === "OPEN_URL") ||
    result.actions?.some((a) => a.type === "INSERT_TEXT") ||
    result.actions?.some((a) => a.type === "NOOP");

  if (!shouldOverride && intent?.kind === "open") {
    return buildYouTubeCommandResult(command);
  }

  if (!shouldOverride) return null;

  const local = buildYouTubeCommandResult(command);
  if (!local) return null;

  console.info(
    `[ripple-desktop] YouTube voice override (B4) — local ${intent?.kind ?? "search"} (backend intent=${result.intent})`,
  );

  return local;
}
