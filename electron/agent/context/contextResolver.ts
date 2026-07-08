import {
  getFocusContext,
  getStickyWebSurface,
  type FocusContext,
  type StickyWebSurface,
} from "../../focus/focusContext.js";

/**
 * Context-Aware Routing Engine — Context Object.
 *
 * A single, serializable snapshot of *where the user is* at the moment a voice
 * command fires. The planner consults this before choosing tools so that a bare
 * "search X" resolves against the current website / app instead of defaulting
 * to a generic Google search.
 */
export interface RippleContext {
  command: string;
  foreground: {
    app: string;
    windowTitle: string;
    domain?: string;
    url?: string;
  };
  accessibility: {
    focusedElement?: string;
    controlType?: string;
  };
}

/** A11y focus hints the caller may already have from the world model. */
export interface AccessibilityHint {
  focusedElement?: string;
  controlType?: string;
}

/** Known web surface → canonical domain + planner workspace id. */
const SURFACE_DOMAINS: Record<StickyWebSurface, { domain: string; workspaceId: string }> = {
  youtube: { domain: "youtube.com", workspaceId: "youtube" },
  gmail: { domain: "mail.google.com", workspaceId: "gmail" },
  whatsapp: { domain: "web.whatsapp.com", workspaceId: "whatsapp" },
  instagram: { domain: "instagram.com", workspaceId: "instagram" },
  linkedin: { domain: "linkedin.com", workspaceId: "linkedin" },
  notion: { domain: "notion.so", workspaceId: "notion" },
  slack: { domain: "slack.com", workspaceId: "slack" },
};

function surfaceFromFocus(ctx: FocusContext): StickyWebSurface | null {
  if (ctx.isYouTube) return "youtube";
  if (ctx.isGmail) return "gmail";
  if (ctx.isWhatsApp) return "whatsapp";
  if (ctx.isInstagram) return "instagram";
  if (ctx.isLinkedIn) return "linkedin";
  if (ctx.isNotion) return "notion";
  if (ctx.isSlack) return "slack";
  return null;
}

/** Extract the registrable domain from a full URL. */
function domainFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    const m = url.match(/^(?:https?:\/\/)?([^/]+)/i);
    return m?.[1]?.toLowerCase().replace(/^www\./, "");
  }
}

/**
 * Resolve the live web/app context, surviving the case where the Ripple window
 * itself is the OS foreground. Falls back to the sticky web surface so context
 * is not lost the moment the user presses the voice hotkey.
 */
export function resolveRippleContext(
  command: string,
  a11y?: AccessibilityHint,
): RippleContext {
  const focus = getFocusContext();
  const app = focus?.processName ?? "unknown";
  const windowTitle = focus?.windowTitle ?? "";
  const url = focus?.activeTabUrl;

  let domain = domainFromUrl(url);
  let surface: StickyWebSurface | null = focus ? surfaceFromFocus(focus) : null;

  // Preservation: if the current foreground is not a recognizable web surface
  // (e.g. the Ripple overlay just took focus), fall back to the sticky surface
  // captured from the last real browser tab.
  if (!surface) {
    surface = getStickyWebSurface();
  }
  if (!domain && surface) {
    domain = SURFACE_DOMAINS[surface].domain;
  }

  const context: RippleContext = {
    command,
    foreground: {
      app,
      windowTitle,
      domain,
      url,
    },
    accessibility: {
      focusedElement: a11y?.focusedElement,
      controlType: a11y?.controlType,
    },
  };

  logContext(context);
  return context;
}

/** The planner workspace id (youtube/gmail/...) implied by the live context. */
export function activeWorkspaceIdFromContext(
  context: RippleContext,
): string | undefined {
  const domain = context.foreground.domain;
  if (!domain) return undefined;
  for (const surface of Object.keys(SURFACE_DOMAINS) as StickyWebSurface[]) {
    if (domain.includes(SURFACE_DOMAINS[surface].domain.replace(/^web\./, ""))) {
      return SURFACE_DOMAINS[surface].workspaceId;
    }
  }
  if (/github\.com/.test(domain)) return "github";
  if (/google\.[a-z.]+$/.test(domain) && !/mail\.google/.test(domain)) {
    return "google";
  }
  return undefined;
}

function logContext(context: RippleContext): void {
  if (process.env.RIPPLE_CONTEXT_TRACE === "0") return;
  console.info(
    `[ripple-context] foreground app=${context.foreground.app} domain=${context.foreground.domain ?? "-"} focused element=${context.accessibility.focusedElement ?? context.accessibility.controlType ?? "-"}`,
  );
}
