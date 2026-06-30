import { APP_ROLE_HINTS, parseAppRolePhrase } from "../desktop/appRoles.js";
import {
  findNativeAppById,
  resolveNativeApp,
} from "../desktop/nativeAppRegistry.js";
import { lookupEntity, lookupAppRole, rankEntities } from "../../storage/knowledgeGraph.js";
import type { Candidate } from "../planner/types.js";
import { isJunkRecallPath } from "./pathRecallFilters.js";

/** Candidate lookup keys — "project" ↔ "my project", app roles, etc. */
export function graphLookupKeys(spoken: string): string[] {
  const key = spoken.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return [];
  const keys = new Set<string>([key]);
  if (key.startsWith("my ")) {
    const stripped = key.slice(3).trim();
    if (stripped) keys.add(stripped);
  } else {
    keys.add(`my ${key}`);
  }
  const role = parseAppRolePhrase(key);
  if (role) keys.add(role);
  return [...keys];
}

/** Resolve a spoken key (e.g. "my resume", "my design app") via knowledge graph. */
export function graphLookup(spoken: string): Candidate | null {
  const keys = graphLookupKeys(spoken);
  if (keys.length === 0) return null;

  for (const key of keys) {
    if (parseAppRolePhrase(key)) {
      const role = lookupAppRole(key);
      if (role) {
        return {
          path: role.path,
          label: role.key,
          score: role.composite_score || 0.9,
          source: "graph",
        };
      }
    }

    const exact = lookupEntity(key);
    if (exact?.path && !isJunkRecallPath(exact.path)) {
      return {
        path: exact.path,
        label: exact.key,
        score: exact.composite_score || 0.95,
        source: "graph",
      };
    }
  }

  const primary = keys[0]!;
  const roleKey = parseAppRolePhrase(primary);
  if (roleKey) {
    const hints = APP_ROLE_HINTS[roleKey] ?? [];
    for (const hint of hints) {
      const app = findNativeAppById(hint) ?? resolveNativeApp(hint);
      if (app) {
        return {
          path: app.id,
          label: roleKey,
          score: 0.75,
          source: "graph",
        };
      }
    }
  }

  const ranked = rankEntities(primary);
  const top = ranked.find((e) => e.path && !isJunkRecallPath(e.path));
  if (top?.path) {
    return {
      path: top.path,
      label: top.key,
      score: top.composite_score || 0.85,
      source: "graph",
    };
  }

  return null;
}
