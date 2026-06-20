const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Exponential recency decay — half-life ~30 days (§3.10). */
export function recencyScore(lastOpenedAtMs: number | null, now = Date.now()): number {
  if (!lastOpenedAtMs) return 0;
  const ageDays = Math.max(0, (now - lastOpenedAtMs) / MS_PER_DAY);
  return Math.exp(-ageDays / 30);
}

export function frequencyScore(openCount: number): number {
  return Math.min(1, Math.log1p(openCount) / Math.log1p(20));
}

export function confirmationBoost(confirmedAtMs: number | null, now = Date.now()): number {
  if (!confirmedAtMs) return 0;
  const ageDays = (now - confirmedAtMs) / MS_PER_DAY;
  return ageDays < 90 ? 0.25 : 0.1;
}

export function compositeScore(args: {
  openCount: number;
  lastOpenedAtMs: number | null;
  confirmedAtMs?: number | null;
}): number {
  const freq = frequencyScore(args.openCount);
  const rec = recencyScore(args.lastOpenedAtMs);
  const conf = confirmationBoost(args.confirmedAtMs ?? null);
  return Math.min(0.99, 0.45 * freq + 0.45 * rec + conf);
}
