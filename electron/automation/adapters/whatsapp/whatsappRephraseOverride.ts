import { randomUUID } from "node:crypto";
import { isWhatsAppTabActive } from "../../../focus/focusContext.js";
import { isEditOrRephraseCommand } from "../../commandIntent.js";
import type { CommandResultPayload } from "../../types.js";

function extractBackendText(result: CommandResultPayload): string {
  const insert = result.actions?.find((a) => a.type === "INSERT_TEXT")?.data?.text;
  if (typeof insert === "string" && insert.trim()) return insert.trim();
  if (typeof result.result === "string" && result.result.trim()) return result.result.trim();
  return "";
}

/** Rephrase / tone on open WhatsApp chat — replace composer via OS-first insert. */
export function applyWhatsAppRephraseOverride(
  command: string,
  result: CommandResultPayload,
): CommandResultPayload | null {
  if (!isWhatsAppTabActive() || !isEditOrRephraseCommand(command)) return null;

  const text = extractBackendText(result);
  if (!text.trim()) {
    console.warn(
      `[ripple-desktop] WA rephrase — backend gave no usable text (intent=${result.intent}, actions=${
        result.actions?.map((a) => a.type).join(",") || "none"
      }, result=${typeof result.result === "string" ? JSON.stringify(result.result.slice(0, 80)) : typeof result.result}) — falling through, nothing will be typed`,
    );
    return null;
  }

  const onlySuggestions =
    result.actions?.length === 1 && result.actions[0]?.type === "SHOW_SUGGESTIONS";

  if (!onlySuggestions && result.intent !== "edit" && !text) return null;

  console.info(
    `[ripple-desktop] WA rephrase — paste ${text.length} chars (backend intent=${result.intent})`,
  );

  return {
    command_id: result.command_id ?? randomUUID(),
    intent: "workflow",
    output_type: "workflow",
    result: text,
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
                _whatsappBatch: true,
                whatsappKind: "replace_composer",
                text,
                command: command.trim(),
              },
            },
          ],
        },
      },
    ],
  };
}
