import { existsSync } from "node:fs";
import {
  findNativeAppById,
  resolveNativeApp,
} from "../../automation/desktop/nativeAppRegistry.js";

export const PLANNER_MEMORY_RECORD_MIN_CONFIDENCE = 0.9;

export type PlannerMemoryKind = "app" | "file" | "folder" | "contact";

export type PlannerMemoryBinding = {
  phrase: string;
  kind: PlannerMemoryKind;
  target: string;
  confidence: number;
  lastUsedAt: number;
  validatedAt: number;
};

export type RecordBindingInput = {
  phrase: string;
  kind: PlannerMemoryKind;
  target: string;
  confidence: number;
  /** True when user picked from disambiguation/clarify — do not auto-record. */
  userOverride?: boolean;
};

const DEFAULT_EXPIRES_MS = 90 * 24 * 60 * 60 * 1000;

export const PLANNER_MEMORY_DEFAULT_TTL_MS = DEFAULT_EXPIRES_MS;

const store = new Map<string, PlannerMemoryBinding>();

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase();
}

function targetExists(kind: PlannerMemoryKind, target: string): boolean {
  if (kind === "file" || kind === "folder") {
    return existsSync(target);
  }
  if (kind === "app") {
    return (
      existsSync(target) ||
      target.includes(":") ||
      resolveNativeApp(target) !== null ||
      findNativeAppById(target) !== undefined
    );
  }
  return Boolean(target.trim());
}

/** Lookup with existence validation — stale bindings are removed. */
export function lookupBinding(phrase: string): PlannerMemoryBinding | null {
  const key = normalizePhrase(phrase);
  const row = store.get(key);
  if (!row) return null;

  if (!targetExists(row.kind, row.target)) {
    store.delete(key);
    return null;
  }

  if (Date.now() > row.validatedAt + DEFAULT_EXPIRES_MS) {
    store.delete(key);
    return null;
  }

  row.lastUsedAt = Date.now();
  return row;
}

/**
 * Record only when confidence ≥ 0.9 and user did not manually override.
 * Knowledge Graph owns user-confirmed aliases.
 */
export function recordBinding(input: RecordBindingInput): boolean {
  if (input.userOverride) return false;
  if (input.confidence < PLANNER_MEMORY_RECORD_MIN_CONFIDENCE) return false;
  if (!targetExists(input.kind, input.target)) return false;

  const key = normalizePhrase(input.phrase);
  const now = Date.now();
  store.set(key, {
    phrase: key,
    kind: input.kind,
    target: input.target,
    confidence: input.confidence,
    lastUsedAt: now,
    validatedAt: now,
  });
  return true;
}

export function deleteBinding(phrase: string): void {
  store.delete(normalizePhrase(phrase));
}

export function clearPlannerMemoryForTests(): void {
  store.clear();
}
