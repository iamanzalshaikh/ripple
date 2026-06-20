import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../../types.js";
import { parseYouTubeCommand } from "./parseYouTubeCommand.js";

/** Local WORKFLOW for YouTube (regex fallback). */
export function buildYouTubeCommandResult(
  command: string,
): CommandResultPayload | null {
  const intent = parseYouTubeCommand(command);
  if (!intent) return null;
  return youtubePayloadFromIntent(intent, command);
}

export function buildYouTubeCommandFromPlan(
  plan: { query: string; kind: "search" | "play" },
  command: string,
): CommandResultPayload {
  return youtubePayloadFromIntent(
    { kind: plan.kind, query: plan.query },
    command,
    "LLM",
  );
}

function youtubePayloadFromIntent(
  intent: { kind: "open" | "search" | "play"; query?: string },
  command: string,
  source = "regex",
): CommandResultPayload {
  let label = intent.kind;
  if ((intent.kind === "search" || intent.kind === "play") && intent.query) {
    label = `${intent.kind} q=${intent.query.slice(0, 50)} (${source})`;
  }

  console.info(`[ripple-desktop] YouTube command — ${label}`);

  const batchData: Record<string, unknown> = {
    _youtubeBatch: true,
    youtubeKind: intent.kind,
    command,
  };

  if ((intent.kind === "search" || intent.kind === "play") && intent.query) {
    batchData.query = intent.query;
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
              data: batchData,
            },
          ],
        },
      },
    ],
  };
}
