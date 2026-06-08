import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../../types.js";
import { parseYouTubeCommand } from "./parseYouTubeCommand.js";

/** Local WORKFLOW for YouTube (no backend LLM required). */
export function buildYouTubeCommandResult(
  command: string,
): CommandResultPayload | null {
  const intent = parseYouTubeCommand(command);
  if (!intent) return null;

  let label = intent.kind;
  if (intent.kind === "search" || intent.kind === "play") {
    label = `${intent.kind} q=${intent.query.slice(0, 50)}`;
  }

  console.info(`[ripple-desktop] YouTube command — ${label}`);

  const batchData: Record<string, unknown> = {
    _youtubeBatch: true,
    youtubeKind: intent.kind,
    command,
  };

  if (intent.kind === "search" || intent.kind === "play") {
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
