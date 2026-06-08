import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../types.js";
import { parseDesktopCommand } from "./parseDesktopCommand.js";

/** Build a local WORKFLOW for folder/file open (no backend LLM required). */
export function buildDesktopCommandResult(
  command: string,
): CommandResultPayload | null {
  const intent = parseDesktopCommand(command);
  if (!intent) return null;

  const label =
    intent.kind === "folder"
      ? `folder:${intent.folder}`
      : `file:${intent.filename}`;

  console.info(`[ripple-desktop] Desktop command — ${label}`);

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
              data: {
                _desktopBatch: true,
                desktopKind: intent.kind,
                folder: intent.kind === "folder" ? intent.folder : undefined,
                filename: intent.kind === "file" ? intent.filename : undefined,
                command,
              },
            },
          ],
        },
      },
    ],
  };
}
