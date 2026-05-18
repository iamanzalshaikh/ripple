import type { CommandResultPayload } from "../automation/types.js";
import { runCommandActions } from "../automation/actionRunner.js";
import { setLastCommandIntent } from "../state/lastCommand.js";
import { rippleSocket } from "../socket/rippleSocket.js";
import {
  apiExecuteCommand,
  type ApiResponse,
} from "./api.js";

export interface RunCommandInput {
  command: string;
  sessionId?: string | null;
  contextMetadata?: Record<string, unknown>;
  getAccessToken: () => Promise<string | null>;
}

export interface RunCommandResult {
  ok: boolean;
  message?: string;
  data?: CommandResultPayload & { execution?: unknown };
  usedRestFallback?: boolean;
}

async function fetchCommandResult(
  input: RunCommandInput,
): Promise<{ data: CommandResultPayload; usedRestFallback: boolean }> {
  if (rippleSocket.isConnected()) {
    try {
      const data = (await rippleSocket.executeCommand({
        command: input.command,
        sessionId: input.sessionId ?? undefined,
        contextMetadata: input.contextMetadata,
      })) as CommandResultPayload;
      return { data, usedRestFallback: false };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Socket command failed";
      console.warn(`[ripple-desktop] socket command failed, trying REST: ${msg}`);
    }
  } else {
    console.warn("[ripple-desktop] socket offline — using REST /commands/execute");
  }

  const access = await input.getAccessToken();
  if (!access) {
    throw new Error("Not authenticated");
  }

  const res = (await apiExecuteCommand(access, {
    sessionId: input.sessionId ?? undefined,
    command: input.command,
    contextMetadata: input.contextMetadata,
  })) as ApiResponse<Record<string, unknown>>;

  if (!res.success) {
    throw new Error(res.message);
  }

  return { data: res.data as CommandResultPayload, usedRestFallback: true };
}

export async function runDesktopCommand(
  input: RunCommandInput,
): Promise<RunCommandResult> {
  try {
    const { data, usedRestFallback } = await fetchCommandResult(input);

    console.info(
      `[ripple-desktop] command:result intent=${data.intent} actions=${data.actions?.length ?? 0} id=${data.command_id}${usedRestFallback ? " (REST)" : ""}`,
    );
    setLastCommandIntent(data.intent);

    let execution = null;
    if (data.actions?.length && data.command_id) {
      console.info(
        `[ripple-desktop] running ${data.actions.length} action(s): ${data.actions.map((a) => a.type).join(", ")}`,
      );
      execution = await runCommandActions(data, (ack) =>
        rippleSocket.sendActionAck(ack),
      );
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
    }

    return {
      ok: true,
      data: { ...data, execution },
      usedRestFallback,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Command failed",
    };
  }
}
