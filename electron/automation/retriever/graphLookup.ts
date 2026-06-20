import { APP_ROLE_HINTS, parseAppRolePhrase } from "../desktop/appRoles.js";
import {
  findNativeAppById,
  resolveNativeApp,
} from "../desktop/nativeAppRegistry.js";
import { lookupEntity, lookupAppRole, rankEntities } from "../../storage/knowledgeGraph.js";
import type { Candidate } from "../planner/types.js";

/** Resolve a spoken key (e.g. "my resume", "my design app") via knowledge graph. */
export function graphLookup(spoken: string): Candidate | null {
  const key = spoken.trim().toLowerCase();
  if (!key) return null;

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

    const roleKey = parseAppRolePhrase(key)!;
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

  const exact = lookupEntity(key);
  if (exact?.path) {
    return {
      path: exact.path,
      label: exact.key,
      score: exact.composite_score || 0.95,
      source: "graph",
    };
  }

  const ranked = rankEntities(key);
  const top = ranked[0];
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
 