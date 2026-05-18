import type { FocusContext } from "../focus/focusContext.js";

/** True when the user is already inside the app Ripple would open. */
export function isAlreadyInTargetApp(
  target: string | undefined,
  ctx: FocusContext | null,
): boolean {
  if (!target || !ctx) return false;

  const key = target.trim().toLowerCase();

  if (key === "whatsapp") {
    return ctx.isWhatsApp;
  }
  if (key === "gmail" || key === "google mail") {
    return ctx.isGmail;
  }
  if (key === "slack") {
    return ctx.isSlack;
  }

  const title = ctx.windowTitle.toLowerCase();
  return title.includes(key);
}
