import type { FocusContext } from "../focus/focusContext.js";

export interface AppDefinition {
  id: string;
  targets: string[];
  urlPattern: RegExp;
  openUrl: string;
  focusCheck?: (ctx: FocusContext) => boolean;
}

export const APP_REGISTRY: AppDefinition[] = [
  {
    id: "whatsapp",
    targets: ["whatsapp"],
    urlPattern: /web\.whatsapp\.com/i,
    openUrl: "https://web.whatsapp.com",
    focusCheck: (ctx) => ctx.isWhatsApp,
  },
  {
    id: "gmail",
    targets: ["gmail", "google mail"],
    urlPattern: /mail\.google\.com/i,
    openUrl: "https://mail.google.com",
    focusCheck: (ctx) => ctx.isGmail,
  },
  {
    id: "slack",
    targets: ["slack"],
    urlPattern: /slack\.com/i,
    openUrl: "https://slack.com",
    focusCheck: (ctx) => ctx.isSlack,
  },
  {
    id: "notion",
    targets: ["notion"],
    urlPattern: /notion\.(so|site)/i,
    openUrl: "https://www.notion.so",
    focusCheck: (ctx) =>
      ctx.windowTitle.toLowerCase().includes("notion") ||
      ctx.processName.toLowerCase().includes("notion"),
  },
  {
    id: "linkedin",
    targets: ["linkedin"],
    urlPattern: /linkedin\.com/i,
    openUrl: "https://www.linkedin.com",
    focusCheck: (ctx) => ctx.windowTitle.toLowerCase().includes("linkedin"),
  },
  {
    id: "youtube",
    targets: ["youtube"],
    urlPattern: /youtube\.com/i,
    openUrl: "https://www.youtube.com",
    focusCheck: (ctx) => ctx.windowTitle.toLowerCase().includes("youtube"),
  },
  {
    id: "instagram",
    targets: ["instagram"],
    urlPattern: /instagram\.com/i,
    openUrl: "https://www.instagram.com",
    focusCheck: (ctx) => ctx.windowTitle.toLowerCase().includes("instagram"),
  },
];

export function findAppByTarget(target?: string): AppDefinition | undefined {
  if (!target) return undefined;
  const key = target.trim().toLowerCase();
  return APP_REGISTRY.find((a) => a.targets.includes(key));
}

export function findAppByUrl(url: string): AppDefinition | undefined {
  return APP_REGISTRY.find((a) => a.urlPattern.test(url));
}

/** User was already in this app when they pressed Ctrl+Space (window focus). */
export function isAlreadyInApp(
  app: AppDefinition,
  ctx: FocusContext | null,
): boolean {
  if (!ctx) return false;
  if (app.focusCheck?.(ctx)) return true;
  const title = ctx.windowTitle.toLowerCase();
  return app.targets.some((t) => title.includes(t));
}
