/**
 * P8.5 Phase 4 — kill switches for legacy orchestrator routers.
 * Default: legacy desktop routers OFF; P8.5 planner + Tool Executor handle desktop.
 */

export function legacyKillSwitchActive(): boolean {
  return process.env.RIPPLE_P85_KILL === "1";
}

/** desktop-fast + desktop-input-fast execution (not shadow-only). */
export function legacyDesktopRoutersEnabled(): boolean {
  return (
    legacyKillSwitchActive() ||
    process.env.RIPPLE_P85_LEGACY_DESKTOP_FAST === "1"
  );
}

/** Early desktop-input path before P8.5 (debug only). */
export function legacyDesktopEarlyInputEnabled(): boolean {
  return (
    legacyDesktopRoutersEnabled() ||
    process.env.RIPPLE_P85_LEGACY_DESKTOP_EARLY === "1"
  );
}

export function legacyPlanDesktopEnabled(): boolean {
  return (
    legacyKillSwitchActive() || process.env.RIPPLE_P85_LEGACY_PLAN === "1"
  );
}

export function legacyAgentCompoundEnabled(): boolean {
  return (
    legacyKillSwitchActive() ||
    process.env.RIPPLE_P85_LEGACY_AGENT_COMPOUND === "1"
  );
}

/** P8.5 universal planner is the default desktop entry. */
export function p85DesktopEntryEnabled(): boolean {
  return !legacyKillSwitchActive();
}
