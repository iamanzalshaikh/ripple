import type { CapabilitySnapshot } from "./toolTypes.js";

const DEFAULT_TTL_MS = 30_000;

type CacheEntry = {
  snapshot: CapabilitySnapshot;
  expiresAt: number;
};

let cache: CacheEntry | null = null;

export function getCachedCapabilitySnapshot(): CapabilitySnapshot | null {
  if (!cache) return null;
  if (Date.now() > cache.expiresAt) {
    cache = null;
    return null;
  }
  return cache.snapshot;
}

export function setCachedCapabilitySnapshot(
  snapshot: CapabilitySnapshot,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  cache = {
    snapshot,
    expiresAt: Date.now() + ttlMs,
  };
}

export function invalidateCapabilitySnapshotCache(): void {
  cache = null;
}

export function clearCapabilitySnapshotCacheForTests(): void {
  cache = null;
}
