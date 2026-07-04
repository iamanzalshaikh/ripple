/**
 * Phase B rollout — controlled by RIPPLE_P85_PHASE_B.
 *
 * Stage 1 (`1` | `split` | `stage1`): split + execute resolved + tail when plannable.
 * Stage 2 (`2` | `execute` | `stage2`): alias — same execution behavior.
 */

export function phaseBStage1Enabled(): boolean {
  const v = process.env.RIPPLE_P85_PHASE_B?.trim();
  if (!v || v === "0") return false;
  return v === "1" || v === "split" || v === "stage1";
}

export function phaseBPartialExecuteEnabled(): boolean {
  const v = process.env.RIPPLE_P85_PHASE_B?.trim();
  return v === "2" || v === "execute" || v === "stage2";
}

/** True when compound partial plans should run (resolved + tail), not clarify-only. */
export function phaseBExecuteEnabled(): boolean {
  return phaseBStage1Enabled() || phaseBPartialExecuteEnabled();
}

export function phaseBAnyEnabled(): boolean {
  return phaseBStage1Enabled() || phaseBPartialExecuteEnabled();
}

/** Log once at Electron boot — confirms desktop .env was loaded into main process. */
export function logPhaseBBootLine(): void {
  const raw = process.env.RIPPLE_P85_PHASE_B?.trim();
  const mode = phaseBPartialExecuteEnabled()
    ? "stage2-execute"
    : phaseBStage1Enabled()
      ? "stage1-execute"
      : "off";
  console.info(
    `[ripple-p85] boot phase-b=${mode}` +
      (raw ? ` (RIPPLE_P85_PHASE_B=${raw})` : " (RIPPLE_P85_PHASE_B unset — set in ripple-desktop/.env)"),
  );
}
