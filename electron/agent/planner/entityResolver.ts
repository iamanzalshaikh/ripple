import type { WorldModel } from "../types.js";
import { resolveNativeApp } from "../../automation/desktop/nativeAppRegistry.js";
import type { NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import {
  firstCompoundClause,
  hasCompoundTailAfterFirstClause,
} from "../../automation/voice/nlu/compoundParse.js";
import { lookupBinding } from "./plannerMemory.js";
import type { ResolvedEntities } from "./toolTypes.js";

export type EntityResolveInput = {
  utterance: string;
  world: WorldModel;
};

const OPEN_APP =
  /^(?:please\s+)?(?:open|launch|start|kholo|chalu)\s+(?:the\s+)?(.+?)\s*$/i;

export type ResolvedApp = NonNullable<ReturnType<typeof resolveNativeApp>>;

/** Resolve a phrase to a native app — planner memory first, then registry. */
export function resolveAppPhrase(phrase: string): ResolvedApp | null {
  const trimmed = phrase.trim();
  if (!trimmed) return null;

  const memory = lookupBinding(trimmed);
  if (memory?.kind === "app") {
    const fromMemory = resolveNativeApp(memory.target);
    if (fromMemory) return fromMemory;
  }

  return resolveNativeApp(trimmed);
}

/** Try to build a launch intent from an utterance (entity resolver fast path). */
export function tryResolveLaunchIntent(
  utterance: string,
): NativeCommandIntent | null {
  const match = utterance.trim().match(OPEN_APP);
  if (!match?.[1]) return null;

  const target = match[1].trim();
  if (hasCompoundTailAfterFirstClause(target)) return null;

  const app = resolveAppPhrase(firstCompoundClause(target));
  if (!app) return null;

  return { kind: "launch_app", app };
}

export async function resolveEntities(
  input: EntityResolveInput,
): Promise<ResolvedEntities> {
  const resolved: ResolvedEntities = {};
  const launch = tryResolveLaunchIntent(input.utterance);
  if (launch && launch.kind === "launch_app") {
    resolved.app = launch.app.id;
    resolved._nativeIntent = launch;
  }
  return resolved;
}

/** Expand plan step args to concrete paths/targets (pass 2 permission input). */
export async function bindStepArgs(
  tool: string,
  args: Record<string, unknown>,
  resolved: ResolvedEntities,
): Promise<Record<string, unknown>> {
  const merged = { ...args, ...resolved };

  if (tool === "desktop.launch_app") {
    if (merged._nativeIntent || merged._desktopPayload) {
      return merged;
    }
    const name =
      typeof merged.app === "string"
        ? merged.app.trim()
        : typeof resolved.app === "string"
          ? resolved.app
          : "";
    if (name) {
      const app = resolveAppPhrase(name);
      if (app) {
        return {
          ...merged,
          app: app.id,
          _nativeIntent: { kind: "launch_app", app } satisfies NativeCommandIntent,
        };
      }
    }
  }

  return merged;
}
