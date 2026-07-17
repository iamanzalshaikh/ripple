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
  /\b(?:focus|timed?\s*out|timeout|not\s+ready|busy|retry|lag|sidecar|econnreset|temporarily|typing\s+verification|a11y_name_mismatch|focus_not_editable)\b/i;
const STALE_PATTERNS =
  /\b(?:window\s+(?:not\s+found|closed)|no\s+target|hwnd|not\s+visible|stale|foreground)\b/i;
const HARD_PATTERNS =
  /\b(?:permission|blocked|denied|invalid|not\s+allowed|policy|enoent|enotdir|no such file)\b/i;
const SAVE_STEP_PATTERNS =
  /\b(?:save\s+(?:as|ui|dialog|verification|file|path|folder)|save_file|ctrl\+s|ctrl\+shift\+s|could not (?:set save|confirm save)|refusing to confirm)\b/i;
const SAVE_FOCUS_HARD_PATTERNS =
  /\b(?:filename field not focused|refusing to paste|refusing second|document still focused|folder bar)\b/i;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when failure originated from desktop.save_file automation. */
export function isSaveStepFailure(error: string, record?: ActionRunRecord): boolean {
  const text = `${error} ${record?.detail ?? ""}`;
  if (SAVE_STEP_PATTERNS.test(text)) return true;
  return /Save (?:As |UI )?did not/i.test(text);
}

export function isSaveFocusHardFailure(error: string): boolean {
  return SAVE_FOCUS_HARD_PATTERNS.test(error);
}

export function maxRecoveryRetriesForFailure(error: string, record?: ActionRunRecord): number {
  if (isSaveStepFailure(error, record)) {
    return isSaveFocusHardFailure(error) ? 0 : 2;
  }
  return plannerConfig.recoveryTransientRetries;
}

/** P8.5j — classify executor failure for bounded recovery. */
export function classifyExecutionFailure(
  error: string,
  record?: ActionRunRecord,
): FailureClass {
  const text = `${error} ${record?.detail ?? ""}`.trim();
  if (HARD_PATTERNS.test(text)) return "hard";
  if (isSaveFocusHardFailure(error)) return "hard";
  // Save-step errors often mention "foreground" — must not trigger full replan.
  if (isSaveStepFailure(error, record)) return "transient";
  if (STALE_PATTERNS.test(text)) return "stale_plan";
  if (TRANSIENT_PATTERNS.test(text)) return "transient";
  if (record?.type === "INSERT_TEXT" && /typing|focus|paste|save/i.test(text)) {
    return "transient";
  }
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
 * When executeFromStep is provided, save failures retry only the failed step.
 */
export async function attemptP85Recovery(input: {
  command: string;
  payload: CommandResultPayload;
  initialSummary: ActionRunSummary;
  execute: (payload: CommandResultPayload) => Promise<ActionRunSummary | null>;
  executeFromStep?: (
    failedIndex: number,
  ) => Promise<ActionRunSummary | null>;
  /** When bridged records are INSERT_TEXT, identify save step by plan index. */
  isSaveStepIndex?: (failedIndex: number) => boolean;
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

    const saveFailure =
      isSaveStepFailure(failed.error, failed) ||
      (input.isSaveStepIndex?.(failed.index) ?? false);
    const failureClass = classifyExecutionFailure(failed.error, failed);
    console.info(
      `[ripple-p85] recovery class=${failureClass} saveOnly=${saveFailure} action=${failed.type} step=${failed.index} err="${failed.error.slice(0, 80)}"`,
    );

    if (failureClass === "hard") {
      return { summary, recovered: false, failureClass, attempts };
    }

    // Save failures: retry only the failed save step — never replan or re-run launch/type.
    if (
      saveFailure &&
      input.executeFromStep &&
      failed.index >= 0 &&
      attempts < maxRecoveryRetriesForFailure(failed.error, failed)
    ) {
      attempts += 1;
      await delay(plannerConfig.recoveryBackoffMs * attempts);
      const rerun = await input.executeFromStep(failed.index);
      if (rerun) {
        summary = rerun;
        if (summary.allSucceeded) {
          return {
            summary,
            recovered: true,
            failureClass: "transient",
            attempts,
          };
        }
      }
      continue;
    }

    if (failureClass === "stale_plan" && input.replan && !replanned && !saveFailure) {
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

    if (
      failureClass === "transient" &&
      !saveFailure &&
      attempts < maxRecoveryRetriesForFailure(failed.error, failed)
    ) {
      attempts += 1;
      await delay(plannerConfig.recoveryBackoffMs * attempts);

      const rerun = await input.execute(input.payload);

      if (rerun) {
        summary = rerun;
        if (summary.allSucceeded) {
          return {
            summary,
            recovered: true,
            failureClass: "transient",
            attempts,
          };
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
