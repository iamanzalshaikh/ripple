import type { ActionRunRecord, ActionRunSummary, CommandResultPayload } from "../../automation/types.js";
import { plannerConfig } from "./plannerConfig.js";

export type FailureClass = "transient" | "stale_plan" | "hard";

export type RecoveryOutcome = {
  summary: ActionRunSummary | null;
  recovered: boolean;
  failureClass?: FailureClass;
  attempts: number;
};

const TRANSIENT_PATTERNS =
  /\b(?:focus|timed?\s*out|timeout|not\s+ready|busy|retry|lag|sidecar|econnreset|temporarily)\b/i;
const STALE_PATTERNS =
  /\b(?:window\s+(?:not\s+found|closed)|no\s+target|hwnd|not\s+visible|stale|foreground)\b/i;
const HARD_PATTERNS =
  /\b(?:permission|blocked|denied|invalid|not\s+allowed|policy)\b/i;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** P8.5j — classify executor failure for bounded recovery. */
export function classifyExecutionFailure(
  error: string,
  record?: ActionRunRecord,
): FailureClass {
  const text = `${error} ${record?.detail ?? ""}`.trim();
  if (HARD_PATTERNS.test(text)) return "hard";
  if (STALE_PATTERNS.test(text)) return "stale_plan";
  if (TRANSIENT_PATTERNS.test(text)) return "transient";
  if (record?.type === "INSERT_TEXT") return "transient";
  return "hard";
}

function firstFailedRecord(summary: ActionRunSummary): ActionRunRecord | undefined {
  return summary.records.find((r) => r.status === "failed");
}

export function recoveryEnabled(): boolean {
  return process.env.RIPPLE_P85_RECOVERY !== "0";
}

/**
 * Bounded recovery: transient retries → optional single replan → return best summary.
 */
export async function attemptP85Recovery(input: {
  command: string;
  payload: CommandResultPayload;
  initialSummary: ActionRunSummary;
  execute: (payload: CommandResultPayload) => Promise<ActionRunSummary | null>;
  replan?: () => Promise<CommandResultPayload | null>;
}): Promise<RecoveryOutcome> {
  if (!recoveryEnabled()) {
    return { summary: input.initialSummary, recovered: false, attempts: 0 };
  }

  let summary = input.initialSummary;
  let attempts = 0;
  let replanned = false;

  while (!summary.allSucceeded && attempts < plannerConfig.recoveryTransientRetries + 1) {
    const failed = firstFailedRecord(summary);
    if (!failed?.error) break;

    const failureClass = classifyExecutionFailure(failed.error, failed);
    console.info(
      `[ripple-p85] recovery class=${failureClass} action=${failed.type} err="${failed.error.slice(0, 80)}"`,
    );

    if (failureClass === "hard") {
      return { summary, recovered: false, failureClass, attempts };
    }

    if (failureClass === "stale_plan" && input.replan && !replanned) {
      replanned = true;
      attempts += 1;
      const newPayload = await input.replan();
      if (!newPayload?.actions?.length || !newPayload.command_id) {
        return { summary, recovered: false, failureClass, attempts };
      }
      const rerun = await input.execute(newPayload);
      if (rerun) {
        summary = rerun;
        if (summary.allSucceeded) {
          return { summary, recovered: true, failureClass, attempts };
        }
      }
      continue;
    }

    if (failureClass === "transient" && attempts < plannerConfig.recoveryTransientRetries) {
      attempts += 1;
      await delay(plannerConfig.recoveryBackoffMs * attempts);
      const rerun = await input.execute(input.payload);
      if (rerun) {
        summary = rerun;
        if (summary.allSucceeded) {
          return { summary, recovered: true, failureClass: "transient", attempts };
        }
      }
      continue;
    }

    break;
  }

  return {
    summary,
    recovered: summary.allSucceeded,
    attempts,
  };
}
