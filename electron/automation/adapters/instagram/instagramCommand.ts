import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../../types.js";
import { parseInstagramCommand } from "./parseInstagramCommand.js";

/** Local WORKFLOW for Instagram (Tier C). */
export function buildInstagramCommandResult(
  command: string,
): CommandResultPayload | null {
  const intent = parseInstagramCommand(command);
  if (!intent) return null;

  let label = intent.kind;
  if (intent.kind === "message") {
    label = `message user=${intent.username} send=${intent.send}`;
  } else if (intent.kind === "compose") {
    label = `open-chat send=${intent.send} (${intent.text.length} chars)`;
  }

  console.info(`[ripple-desktop] DM command — ${label}`);

  const batchData: Record<string, unknown> = {
    _instagramBatch: true,
    instagramKind: intent.kind,
    command,
  };

  if (intent.kind === "message") {
    batchData.username = intent.username;
    batchData.text = intent.text;
    batchData.send = intent.send;
  } else if (intent.kind === "compose") {
    batchData.text = intent.text;
    batchData.send = intent.send;
    batchData.pasteOnly = true;
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
