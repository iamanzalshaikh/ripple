import { findAppByTarget, isAlreadyInApp } from "./appRegistry.js";
import type { FocusContext } from "../focus/focusContext.js";

/** True when the user was already in this app before voice (skip OPEN_APP / new tab). */
export function isAlreadyInTargetApp(
  target: string | undefined,
  ctx: FocusContext | null,
): boolean {
  if (!target || !ctx) return false;
  const app = findAppByTarget(target);
  if (app) return isAlreadyInApp(app, ctx);
  const key = target.trim().toLowerCase();
  return ctx.windowTitle.toLowerCase().includes(key);
}
