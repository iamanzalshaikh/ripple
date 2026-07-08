import type { WorldModel } from "../types.js";
import type { ExecutionPlan } from "./planTypes.js";
import { TOOL_MANIFEST_VERSION } from "./toolDefinitions.js";
import { plannerConfig } from "./plannerConfig.js";

type CacheEntry = {
  plan: ExecutionPlan;
  storedAt: number;
  manifestVersion: string;
};

const cache = new Map<string, CacheEntry>();

const NON_CACHEABLE_TOOLS = new Set([
  "desktop.close_window",
  "browser.whatsapp.send",
  "browser.gmail.compose",
  "browser.youtube.run",
  "browser.linkedin.run",
]);

const COMMUNICATION_PREFIXES = ["browser.whatsapp.", "browser.gmail.", "communication."];

function cacheEnabled(): boolean {
  return process.env.RIPPLE_P85_CACHE !== "0";
}

/** Relevant world fields for cache key — not full snapshot. */
export function worldFieldsForCacheKey(world: WorldModel): Record<string, unknown> {
  return {
    fg: world.foreground?.processName ?? null,
    browser: world.browser.surface ?? null,
    clipboard: world.clipboard.hasText,
  };
}

export function buildPlanCacheKey(
  normalizedUtterance: string,
  world: WorldModel,
): string {
  const worldKey = JSON.stringify(worldFieldsForCacheKey(world));
  return `${normalizedUtterance.trim().toLowerCase()}|${worldKey}|${TOOL_MANIFEST_VERSION}`;
}

export function isPlanCacheable(plan: ExecutionPlan): boolean {
  if (!cacheEnabled()) return false;
  if (plan.needsClarification) return false;
  if (plan.source === "L0") return false;
  for (const step of plan.steps) {
    if (NON_CACHEABLE_TOOLS.has(step.tool)) return false;
    if (COMMUNICATION_PREFIXES.some((p) => step.tool.startsWith(p))) return false;
  }
  return plan.steps.length > 0;
}

export function lookupCachedPlan(
  normalizedUtterance: string,
  world: WorldModel,
): ExecutionPlan | null {
  if (!cacheEnabled()) return null;

  const key = buildPlanCacheKey(normalizedUtterance, world);
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.manifestVersion !== TOOL_MANIFEST_VERSION) {
    cache.delete(key);
    return null;
  }

  if (Date.now() - entry.storedAt > plannerConfig.cacheTtlMs) {
    cache.delete(key);
    return null;
  }

  console.info(`[ripple-p85] cache hit norm="${normalizedUtterance.slice(0, 50)}"`);
  return {
    ...entry.plan,
    source: "cache",
  };
}

export function storeCachedPlan(
  normalizedUtterance: string,
  world: WorldModel,
  plan: ExecutionPlan,
): void {
  if (!isPlanCacheable(plan)) return;

  const key = buildPlanCacheKey(normalizedUtterance, world);
  cache.set(key, {
    plan: structuredClone(plan),
    storedAt: Date.now(),
    manifestVersion: TOOL_MANIFEST_VERSION,
  });
}

export function clearPlanCache(): void {
  cache.clear();
}

export function planCacheSize(): number {
  return cache.size;
}
