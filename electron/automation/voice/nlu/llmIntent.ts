import { API_BASE } from "../../../services/api.js";
import type { DesktopIntentPlan } from "./intentFromLlm.js";
import {
  transcriptContentLoggingEnabled,
  transcriptDebugLabel,
} from "../transcriptPipeline.js";

export type DesktopIntentSession = {
  lastCommand?: string;
  lastIntent?: string;
  lastFile?: string;
  lastFolder?: string;
  lastContact?: string;
  recentTurns?: Array<{
    command: string;
    intent?: string;
    resolved_path?: string;
    outcome: string;
  }>;
};

export async function fetchDesktopIntentFromLlm(
  accessToken: string,
  command: string,
  nlu?: string,
  session?: DesktopIntentSession,
  worldModel?: Record<string, unknown>,
  intentHint?: string,
): Promise<DesktopIntentPlan | null> {
  const rawOnly = !nlu?.trim();
  // Row 13.6 — don't print the spoken command in production builds.
  const detail = transcriptContentLoggingEnabled()
    ? `command=${transcriptDebugLabel(command.trim(), 60)}${nlu?.trim() ? ` | nlu=${transcriptDebugLabel(nlu.trim(), 60)}` : ""}`
    : `command_len=${command.trim().length}${nlu?.trim() ? ` | nlu_len=${nlu.trim().length}` : ""}`;
  console.info(
    `[ripple-desktop] GPT desktop-intent request: ${rawOnly ? "raw" : "nlu"} speech | ${detail}`,
  );

  try {
    const res = await fetch(`${API_BASE}/commands/desktop-intent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: command.trim(),
        nlu: nlu?.trim() || undefined,
        last_command: session?.lastCommand?.trim() || undefined,
        last_intent: session?.lastIntent?.trim() || undefined,
        last_file: session?.lastFile?.trim() || undefined,
        last_folder: session?.lastFolder?.trim() || undefined,
        last_contact: session?.lastContact?.trim() || undefined,
        recent_turns: session?.recentTurns?.length
          ? session.recentTurns
          : undefined,
        world_model: worldModel,
        intent_hint: intentHint,
      }),
    });

    const body = (await res.json()) as {
      success: boolean;
      data?: { plan: DesktopIntentPlan };
      message?: string;
    };

    if (!res.ok || !body.success || !body.data?.plan) {
      console.warn(
        `[ripple-desktop] LLM desktop intent failed: ${body.message ?? res.status}`,
      );
      return null;
    }

    console.info(
      `[ripple-desktop] LLM desktop intent: ${body.data.plan.action} (conf=${body.data.plan.confidence})`,
    );
    return body.data.plan;
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] LLM desktop intent error:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
