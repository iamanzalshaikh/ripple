/** P8.5 — tunable planner thresholds (env overrides supported). */

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const plannerConfig = {
  /** Execute immediately when confidence is at or above this. */
  executeThreshold: envNum("RIPPLE_P85_CONF_EXECUTE", 0.8),
  /** Below this → clarification instead of execution. */
  clarifyThreshold: envNum("RIPPLE_P85_CONF_CLARIFY", 0.2),
  /** L0 high-confidence bypass. */
  l0BypassThreshold: envNum("RIPPLE_P85_CONF_L0_BYPASS", 0.9),
  /** Destructive tools need at least this confidence. */
  destructiveFloor: envNum("RIPPLE_P85_CONF_DESTRUCTIVE", 0.95),
  /** Planner cache TTL (ms). */
  cacheTtlMs: envNum("RIPPLE_P85_CACHE_TTL_MS", 10 * 60 * 1000),
  /** Max transient retries per failed step. */
  recoveryTransientRetries: envNum("RIPPLE_P85_RECOVERY_RETRIES", 2),
  /** Backoff between transient retries (ms). */
  recoveryBackoffMs: envNum("RIPPLE_P85_RECOVERY_BACKOFF_MS", 400),
  /** Max clarification rounds before giving up. */
  clarificationMaxRounds: envNum("RIPPLE_P85_CLARIFY_MAX_ROUNDS", 2),
};
