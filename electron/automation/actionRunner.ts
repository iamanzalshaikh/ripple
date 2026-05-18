import { BrowserWindow } from "electron";
import { dismissOverlay } from "../windows/overlay.js";
import { executeSingleAction } from "./executeAction.js";
import type {
  ActionAckPayload,
  ActionRunRecord,
  ActionRunSummary,
  CommandResultPayload,
  RippleAction,
} from "./types.js";

export type SendAckFn = (ack: ActionAckPayload) => Promise<void>;

function broadcastExecution(summary: ActionRunSummary, result: CommandResultPayload): void {
  const payload = {
    command_id: summary.command_id,
    intent: result.intent,
    result: result.result,
    records: summary.records,
    allSucceeded: summary.allSucceeded,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("actions:executed", payload);
    }
  }
}

export async function runCommandActions(
  result: CommandResultPayload,
  sendAck: SendAckFn,
): Promise<ActionRunSummary | null> {
  const commandId = result.command_id;
  const actions = result.actions ?? [];

  if (!commandId || actions.length === 0) {
    return null;
  }

  const records: ActionRunRecord[] = [];

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]!;
    try {
      const detail = await executeSingleAction(action);
      records.push({
        index,
        type: action.type,
        status: "executed",
        detail,
      });
      console.info(
        `[ripple-desktop] action[${index}] ${action.type} OK — ${detail}`,
      );
      await sendAck({
        command_id: commandId,
        action_index: index,
        status: "executed",
      });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : "Action failed";
      records.push({
        index,
        type: action.type,
        status: "failed",
        error,
      });
      console.error(
        `[ripple-desktop] action[${index}] ${action.type} FAIL — ${error}`,
      );
      await sendAck({
        command_id: commandId,
        action_index: index,
        status: "failed",
        error,
      });
    }
  }

  const summary: ActionRunSummary = {
    command_id: commandId,
    records,
    allSucceeded: records.every((r) => r.status === "executed"),
  };

  broadcastExecution(summary, result);
  dismissOverlay(summary.allSucceeded ? 1400 : 2800);
  return summary;
}
