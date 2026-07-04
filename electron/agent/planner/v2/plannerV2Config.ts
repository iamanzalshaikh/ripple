/**
 * Planner v2 rollout — RIPPLE_P85_PLANNER_V2
 *
 * `1` | `compound` — compounds only (v2.1)
 * `2` | `all` | `atomic` — compounds + atomic (v2.2+)
 * `0` or unset — legacy L0 clause parsers
 */

export function plannerV2CompoundEnabled(): boolean {
  const v = process.env.RIPPLE_P85_PLANNER_V2?.trim();
  if (!v || v === "0") return false;
  return (
    v === "1" ||
    v === "compound" ||
    v === "2" ||
    v === "all" ||
    v === "atomic"
  );
}

export function plannerV2AtomicEnabled(): boolean {
  const v = process.env.RIPPLE_P85_PLANNER_V2?.trim();
  if (!v || v === "0") return false;
  return v === "2" || v === "all" || v === "atomic";
}

export function logPlannerV2BootLine(): void {
  const raw = process.env.RIPPLE_P85_PLANNER_V2?.trim();
  const mode = plannerV2AtomicEnabled()
    ? "all"
    : plannerV2CompoundEnabled()
      ? "compound"
      : "off";
  if (mode !== "off" || raw) {
    console.info(
      `[ripple-p85] boot planner-v2=${mode}` +
        (raw ? ` (RIPPLE_P85_PLANNER_V2=${raw})` : ""),
    );
  }
}
