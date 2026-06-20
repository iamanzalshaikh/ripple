/** Sliding-window rate limits per tool (§3.9). */

import type { CommandResultPayload } from "../types.js";

type LimitRule = { max: number; windowMs: number };

const LIMITS: Record<string, LimitRule> = {
  launch_app: { max: 20, windowMs: 5 * 60_000 },
  switch_app: { max: 20, windowMs: 5 * 60_000 },
  close_app: { max: 15, windowMs: 5 * 60_000 },
  create_folder: { max: 30, windowMs: 5 * 60_000 },
  create_file: { max: 30, windowMs: 5 * 60_000 },
  delete_file: { max: 10, windowMs: 10 * 60_000 },
  move_file: { max: 15, windowMs: 10 * 60_000 },
  rename_file: { max: 15, windowMs: 10 * 60_000 },
  whatsapp_message: { max: 10, windowMs: 10 * 60_000 },
  default: { max: 80, windowMs: 5 * 60_000 },
};

const buckets = new Map<string, number[]>();

function ruleFor(tool: string): LimitRule {
  return LIMITS[tool] ?? LIMITS.default!;
}

function prune(key: string, now: number, windowMs: number): number[] {
  const hits = buckets.get(key) ?? [];
  const fresh = hits.filter((t) => now - t < windowMs);
  buckets.set(key, fresh);
  return fresh;
}

/** Returns false when the tool has exceeded its sliding-window cap. */
export function checkActionLimit(tool: string): boolean {
  const key = tool.trim().toLowerCase() || "default";
  const rule = ruleFor(key);
  const now = Date.now();
  const hits = prune(key, now, rule.windowMs);
  return hits.length < rule.max;
}

export function recordActionUse(tool: string): void {
  const key = tool.trim().toLowerCase() || "default";
  const rule = ruleFor(key);
  const now = Date.now();
  const hits = prune(key, now, rule.windowMs);
  hits.push(now);
  buckets.set(key, hits);
}

export function limitMessageFor(tool: string): string {
  const rule = ruleFor(tool.trim().toLowerCase() || "default");
  const mins = Math.ceil(rule.windowMs / 60_000);
  return `Too many "${tool}" commands — wait about ${mins} minute(s) and try again.`;
}

/** Reset buckets — tests only. */
export function resetActionLimiterForTests(): void {
  buckets.clear();
}

export function primaryToolFromPayload(payload: CommandResultPayload): string {
  const steps = payload.actions?.[0]?.data?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return "default";
  const first = steps[0]?.data as Record<string, unknown> | undefined;
  const kind = first?.desktopKind;
  return typeof kind === "string" ? kind : "default";
}

export function rateLimitForPayload(payload: CommandResultPayload): string | null {
  const tool = primaryToolFromPayload(payload);
  if (checkActionLimit(tool)) return null;
  return limitMessageFor(tool);
}
