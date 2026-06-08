import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../../types.js";
import { parseLinkedInCommand } from "./parseLinkedInCommand.js";

/** Local WORKFLOW for LinkedIn (Tier C). */
export function buildLinkedInCommandResult(
  command: string,
): CommandResultPayload | null {
  const intent = parseLinkedInCommand(command);
  if (!intent) return null;

  let label = intent.kind;
  if (intent.kind === "search_people") label = `search_people q=${intent.query.slice(0, 40)}`;
  if (intent.kind === "create_post") {
    label = `create_post publish=${intent.publish}`;
  }

  console.info(`[ripple-desktop] LinkedIn command — ${label}`);

  const batchData: Record<string, unknown> = {
    _linkedinBatch: true,
    linkedinKind: intent.kind,
    command,
  };

  if (intent.kind === "search_people") {
    batchData.query = intent.query;
  }
  if (intent.kind === "create_post") {
    if (intent.text) batchData.text = intent.text;
    batchData.publish = intent.publish;
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
