/** P8.5 — shadow-mode router parity counters for legacy deprecation. */

export type RouterMismatchRecord = {
  legacyRouter: string;
  p85Reason: string;
  command: string;
  at: number;
};

const MAX_MISMATCH = 200;
const mismatches: RouterMismatchRecord[] = [];
let p85ExecuteCount = 0;

export function recordP85Execute(): void {
  p85ExecuteCount += 1;
}

export function recordRouterMismatch(
  legacyRouter: string,
  p85Reason: string,
  command: string,
): void {
  mismatches.push({
    legacyRouter,
    p85Reason,
    command: command.slice(0, 120),
    at: Date.now(),
  });
  if (mismatches.length > MAX_MISMATCH) {
    mismatches.splice(0, mismatches.length - MAX_MISMATCH);
  }
}

export type RouterParitySnapshot = {
  p85Executes: number;
  mismatchTotal: number;
  byLegacyRouter: Record<string, number>;
  recentMismatches: RouterMismatchRecord[];
  /** True when mismatches are low relative to P8.5 traffic. */
  readyForDeprecation: boolean;
};

export function getRouterParitySnapshot(): RouterParitySnapshot {
  const byLegacyRouter: Record<string, number> = {};
  for (const m of mismatches) {
    byLegacyRouter[m.legacyRouter] = (byLegacyRouter[m.legacyRouter] ?? 0) + 1;
  }

  const mismatchTotal = mismatches.length;
  const ratio =
    p85ExecuteCount > 0 ? mismatchTotal / p85ExecuteCount : mismatchTotal > 0 ? 1 : 0;
  const readyForDeprecation =
    p85ExecuteCount >= 20 && ratio < 0.05 && mismatchTotal < 10;

  return {
    p85Executes: p85ExecuteCount,
    mismatchTotal,
    byLegacyRouter,
    recentMismatches: mismatches.slice(-12).reverse(),
    readyForDeprecation,
  };
}

export function resetRouterParity(): void {
  mismatches.length = 0;
  p85ExecuteCount = 0;
}
