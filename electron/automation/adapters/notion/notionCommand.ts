import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../../types.js";
import { parseNotionCommand } from "./parseNotionCommand.js";

/** Local WORKFLOW for Notion (no backend required). */
export function buildNotionCommandResult(
  command: string,
): CommandResultPayload | null {
  const intent = parseNotionCommand(command);
  if (!intent) return null;

  let label: string = intent.kind;
  if (intent.kind === "create_page") {
    const bits = [
      `paste=${intent.pasteClipboard}`,
      intent.title ? `title=${intent.title.slice(0, 30)}` : null,
      intent.body ? `body=${intent.body.length}ch` : null,
      intent.workspace ? `ws=${intent.workspace}` : null,
    ].filter(Boolean);
    label = `create_page ${bits.join(" ")}`;
  } else if (intent.workspace) {
    label = `open ws=${intent.workspace}`;
  }

  console.info(`[ripple-desktop] Notion command — ${label}`);

  const batchData: Record<string, unknown> = {
    _notionBatch: true,
    notionKind: intent.kind,
    command,
  };

  if (intent.kind === "create_page") {
    batchData.pasteClipboard = intent.pasteClipboard;
    batchData.title = intent.title;
    batchData.body = intent.body;
    batchData.workspace = intent.workspace;
  } else {
    batchData.workspace = intent.workspace;
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
