import type { RippleContext } from "./contextResolver.js";
import { activeWorkspaceIdFromContext } from "./contextResolver.js";

/**
 * Context-Aware Routing Engine — routing rules + priority.
 *
 * Given a voice command and the live {@link RippleContext}, decide how a
 * search-like intent should be routed. The engine is generic: website rules are
 * table-driven, not hardcoded to a single site.
 */
export type SearchRoute = {
  /** Human-readable decision id, e.g. "youtube_search". */
  decision: string;
  /** Search engine hint for the browser tools. */
  searchEngine: "youtube" | "google";
  /** Planner workspace id when the route maps to a workspace. */
  workspaceId?: string;
  /** Why this route was chosen (for logs / debugging). */
  reason: string;
};

/** Website domain → routing behavior. Extend this table for new sites. */
const WEBSITE_RULES: Array<{
  match: RegExp;
  decision: string;
  searchEngine: "youtube" | "google";
  workspaceId?: string;
}> = [
  { match: /youtube\.com/, decision: "youtube_search", searchEngine: "youtube", workspaceId: "youtube" },
  { match: /github\.com/, decision: "github_search", searchEngine: "google", workspaceId: "github" },
  { match: /(?:^|\.)google\.[a-z.]+$/, decision: "google_search", searchEngine: "google", workspaceId: "google" },
];

/** Application (non-browser) → routing behavior. */
const APP_RULES: Array<{ match: RegExp; decision: string; searchEngine: "youtube" | "google" }> = [
  { match: /^(?:code|cursor|devenv|idea|pycharm|webstorm|sublime|atom)$/i, decision: "code_search", searchEngine: "google" },
];

/** Explicit "on <site>" targets spoken by the user (highest priority). */
const EXPLICIT_TARGETS: Array<{ match: RegExp; route: SearchRoute }> = [
  {
    match: /\b(?:on|in|at|using|via)\s+youtube\b/i,
    route: { decision: "youtube_search", searchEngine: "youtube", workspaceId: "youtube", reason: "explicit_target=youtube" },
  },
  {
    match: /\b(?:on|in|at|using|via)\s+(?:google|the\s+web|internet|browser|chrome)\b/i,
    route: { decision: "google_search", searchEngine: "google", workspaceId: "google", reason: "explicit_target=google" },
  },
  {
    match: /\b(?:on|in|at|using|via)\s+github\b/i,
    route: { decision: "github_search", searchEngine: "google", workspaceId: "github", reason: "explicit_target=github" },
  },
];

/**
 * Resolve the search route using the documented priority order:
 *   1. Explicit user target  ("search on Google for X")
 *   2. Current website context  (user is on youtube.com)
 *   3. Current application context  (VS Code → code search)
 *   4. Fallback: generic web search
 */
export function resolveSearchRoute(context: RippleContext): SearchRoute {
  const command = context.command;

  // 1 — explicit target wins.
  for (const target of EXPLICIT_TARGETS) {
    if (target.match.test(command)) {
      return logRoute(target.route);
    }
  }

  // 2 — current website context.
  const domain = context.foreground.domain;
  if (domain) {
    for (const rule of WEBSITE_RULES) {
      if (rule.match.test(domain)) {
        return logRoute({
          decision: rule.decision,
          searchEngine: rule.searchEngine,
          workspaceId: rule.workspaceId,
          reason: `current_domain=${domain}`,
        });
      }
    }
  }

  // 3 — current application context (non-browser apps).
  const app = context.foreground.app;
  if (app && !domain) {
    for (const rule of APP_RULES) {
      if (rule.match.test(app)) {
        return logRoute({
          decision: rule.decision,
          searchEngine: rule.searchEngine,
          reason: `current_app=${app}`,
        });
      }
    }
  }

  // 4 — fallback.
  return logRoute({
    decision: "web_search",
    searchEngine: "google",
    workspaceId: "google",
    reason: "fallback_generic_web",
  });
}

/**
 * Workspace id the context implies (used by the Planner v2 classifier to bias a
 * bare "search X" toward the current site). Returns undefined for generic web.
 */
export function activeSearchWorkspaceId(context: RippleContext): string | undefined {
  return activeWorkspaceIdFromContext(context);
}

function logRoute(route: SearchRoute): SearchRoute {
  if (process.env.RIPPLE_CONTEXT_TRACE === "0") return route;
  console.info(
    `[ripple-router] decision=${route.decision} reason=${route.reason}`,
  );
  return route;
}
