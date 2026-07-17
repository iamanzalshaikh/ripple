import type { ExecutionPlan, PlannerPipelineResult, PlannerShadowRecord, PlannerPartialResult } from "./planTypes.js";
import type { CommandResultPayload } from "../../automation/types.js";
import { recordPlannerMetric } from "./planMetrics.js";
import { persistPlannerShadow } from "./planPersistence.js";
import { recordRouterMismatch } from "./routerParity.js";

let shadowModeEnabled = false;

export function setPlannerShadowMode(enabled: boolean): void {
  shadowModeEnabled = enabled;
}

export function isPlannerShadowMode(): boolean {
  if (process.env.RIPPLE_P85_SHADOW === "0") return false;
  if (process.env.RIPPLE_P85_SHADOW === "1") return true;
  return shadowModeEnabled;
}

/** Always-on diagnostic (set RIPPLE_P85_PLAN_LOG=0 to silence). */
export function isExecutionPlanLogEnabled(): boolean {
  return process.env.RIPPLE_P85_PLAN_LOG !== "0";
}

function sanitizePlanArgsForLog(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "_desktopPayload") {
      out[key] = "[CommandResultPayload]";
      continue;
    }
    if (key === "_nativeIntent" && value && typeof value === "object") {
      const kind = (value as { kind?: string }).kind ?? "intent";
      out[key] = `[native:${kind}]`;
      continue;
    }
    if (typeof value === "string" && value.length > 100) {
      out[key] = `${value.slice(0, 100)}…`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Full ExecutionPlan dump — planner output, before Tool Executor / payload bridge.
 * Use to verify whether steps (e.g. desktop.save_file) exist in the plan itself.
 */
export function logExecutionPlan(plan: ExecutionPlan, stage: string): void {
  if (!isExecutionPlanLogEnabled()) return;

  const tools = plan.steps.map((s) => s.tool).join(", ") || "-";
  const steps = plan.steps.map((step, index) => ({
    index,
    tool: step.tool,
    reason: step.reason ?? "",
    args: sanitizePlanArgsForLog(step.args),
  }));

  console.info(
    `[ripple-p85] execution-plan stage=${stage} source=${plan.source} ` +
      `conf=${plan.confidence} steps=${plan.steps.length} tools=${tools} ` +
      `goal="${plan.goal}" norm="${plan.normalizedUtterance.slice(0, 80)}"`,
  );
  console.info(
    `[ripple-p85] execution-plan stage=${stage} json=${JSON.stringify({ steps })}`,
  );
}

/** Compare plan step count vs bridged payload — detects steps dropped after planner. */
export function logPayloadBridgeDiagnostic(
  plan: ExecutionPlan,
  payload: CommandResultPayload,
  builtKind: "payload" | "executor",
): void {
  if (!isExecutionPlanLogEnabled()) return;

  const planTools = plan.steps.map((s) => s.tool);
  const actionHints = (payload.actions ?? []).map((action, index) => {
    const data = (action.data ?? {}) as Record<string, unknown>;
    const tool =
      typeof data._p85Tool === "string"
        ? data._p85Tool
        : data._nativeIntent
          ? "desktop.launch_app"
          : typeof data.text === "string"
            ? "desktop.type_text"
            : action.type;
    return `${index}:${tool}`;
  });

  const mismatch =
    plan.steps.length !== (payload.actions?.length ?? 0)
      ? " step_count_mismatch"
      : "";

  console.info(
    `[ripple-p85] payload-bridge kind=${builtKind} intent=${payload.intent} ` +
      `plan_steps=${plan.steps.length} [${planTools.join(", ")}] ` +
      `payload_actions=${payload.actions?.length ?? 0} [${actionHints.join(", ")}]${mismatch}`,
  );
}

/** Phase B Stage 1 — structured split preview + resolved-only execution plan (no execute). */
export function logPhaseBSplit(result: PlannerPartialResult): void {
  if (!isExecutionPlanLogEnabled() && !isPlannerShadowMode()) return;

  const stages = result.splitPreview.map((stage) => ({
    index: stage.index,
    clause: stage.clause,
    status: stage.status,
    ...(stage.tool ? { tool: stage.tool } : {}),
    ...(stage.action ? { action: stage.action } : {}),
    ...(stage.summary ? { summary: stage.summary } : {}),
  }));

  console.info(
    `[ripple-p85] phase-b split stages=${JSON.stringify(stages)} ` +
      `resolved=${result.plan.steps.length} unresolved=${result.unresolvedClauses.length}`,
  );
  logExecutionPlan(result.plan, "phase-b-resolved-only");
}

export function logPlannerShadow(record: PlannerShadowRecord): void {
  recordPlannerMetric(record);
  persistPlannerShadow(record);
  if (!isPlannerShadowMode()) return;

  const tools = record.tools?.join(", ") ?? "-";
  console.info(
    `[ripple-p85] shadow kind=${record.resultKind} source=${record.source ?? "-"} ` +
      `conf=${record.confidence ?? "-"} tools=${tools} ${record.latencyMs}ms ` +
      `norm="${record.normalizedUtterance.slice(0, 60)}"` +
      (record.validationErrors?.length
        ? ` validation=${record.validationErrors.join(";")}`
        : "") +
      (record.reason ? ` reason=${record.reason}` : ""),
  );
}

export function shadowFromPipelineResult(
  raw: string,
  normalized: string,
  result: PlannerPipelineResult,
  latencyMs: number,
): void {
  if (result.kind === "execute") {
    logPlannerShadow({
      rawUtterance: raw,
      normalizedUtterance: normalized,
      resultKind: "execute",
      source: result.plan.source,
      goal: result.plan.goal,
      tools: result.plan.steps.map((s) => s.tool),
      confidence: result.plan.confidence,
      latencyMs,
    });
    logExecutionPlan(result.plan, "planner-out");
    return;
  }

  if (result.kind === "clarify") {
    logPlannerShadow({
      rawUtterance: raw,
      normalizedUtterance: normalized,
      resultKind: "clarify",
      confidence: result.confidence,
      reason: result.reason,
      latencyMs,
    });
    return;
  }

  if (result.kind === "partial") {
    logPlannerShadow({
      rawUtterance: raw,
      normalizedUtterance: normalized,
      resultKind: "partial",
      source: result.plan.source,
      goal: result.plan.goal,
      tools: result.plan.steps.map((s) => s.tool),
      confidence: result.confidence,
      reason: result.reason,
      latencyMs,
    });
    logPhaseBSplit(result);
    return;
  }

  logPlannerShadow({
    rawUtterance: raw,
    normalizedUtterance: normalized,
    resultKind: "defer",
    reason: result.reason,
    latencyMs,
  });
}

/** Shadow: P8.5 deferred but legacy desktop-fast router would have matched. */
export function logPlannerRouterMismatch(
  command: string,
  p85Reason: string,
  legacyRouter: string,
  legacyPayload: CommandResultPayload,
): void {
  recordRouterMismatch(legacyRouter, p85Reason, command);
  if (!isPlannerShadowMode()) return;
  const intent = legacyPayload.intent ?? "unknown";
  const actionTypes =
    legacyPayload.actions?.map((a) => a.type).join(",") ?? "-";
  console.info(
    `[ripple-p85] shadow mismatch legacy=${legacyRouter} intent=${intent} ` +
      `actions=${actionTypes} p85_reason=${p85Reason} ` +
      `norm="${command.slice(0, 60)}"`,
  );
}
