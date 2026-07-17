import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import { isWebOnlyAppTarget, resolveNativeApp } from "./nativeAppRegistry.js";
import type { NativeAppEntry } from "./nativeAppRegistry.js";
import { firstCompoundClause, hasCompoundTailAfterFirstClause } from "../voice/nlu/compoundParse.js";

export type NativeAppIntent =
  | { kind: "launch_app"; app: NativeAppEntry; rawName: string }
  | { kind: "switch_app"; app: NativeAppEntry; rawName: string }
  | { kind: "close_app"; app: NativeAppEntry; rawName: string }
  | { kind: "minimize_all" };

const FOLDER_NAMES = new Set(["download", "downloads", "document", "documents", "desktop"]);

function looksLikeFile(name: string): boolean {
  return /\.[a-z0-9]{2,8}$/i.test(name.trim());
}

function looksLikeFolder(name: string): boolean {
  return FOLDER_NAMES.has(name.trim().toLowerCase());
}

function resolveAppName(raw: string): NativeAppEntry | null {
  const trimmed = firstCompoundClause(raw.trim().replace(/\s+/g, " "));
  if (!trimmed || looksLikeFile(trimmed) || looksLikeFolder(trimmed)) return null;
  if (isWebOnlyAppTarget(trimmed)) return null;
  return resolveNativeApp(trimmed);
}

/** True when open target continues with type/save/etc. — defer to compound planner. */
function openTargetHasCompoundTail(target: string): boolean {
  return hasCompoundTailAfterFirstClause(target);
}

/**
 * Parse native app control commands (launch, switch, close, minimize).
 * Returns null for web-only apps and folder/file commands.
 */
export function parseNativeAppCommand(
  command?: string | null,
): NativeAppIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  if (/^\s*minimize\s+(?:all\s+)?(?:windows?|everything)\s*\.?\s*$/i.test(cmd)) {
    return { kind: "minimize_all" };
  }

  const switchMatch = cmd.match(
    /^\s*(?:switch\s+(?:focus\s+)?to|focus(?:\s+on)?|go\s+to)\s+(?:the\s+)?(?:app\s+)?(.+?)\s*\.?\s*$/i,
  );
  if (switchMatch?.[1]) {
    const app = resolveAppName(switchMatch[1]);
    if (app) {
      return { kind: "switch_app", app, rawName: switchMatch[1].trim() };
    }
  }

  const closeMatch = cmd.match(
    /^\s*(?:close|quit|exit)\s+(?:the\s+)?(?:app\s+)?(.+?)\s*\.?\s*$/i,
  );
  if (closeMatch?.[1]) {
    const app = resolveAppName(closeMatch[1]);
    if (app) {
      return { kind: "close_app", app, rawName: closeMatch[1].trim() };
    }
  }

  const openMatch = cmd.match(
    /^\s*(?:open|launch|start)\s+(?:the\s+)?(?:app\s+)?(.+?)\s*\.?\s*$/i,
  );
  if (openMatch?.[1]) {
    if (/\s+(?:in|on)\s+(?:my\s+)?(?:downloads?|documents?|desktop)\s*$/i.test(cmd)) {
      return null;
    }
    const target = openMatch[1].trim();
    if (openTargetHasCompoundTail(target)) {
      return null;
    }
    const app = resolveAppName(target);
    if (app) {
      const shortName = firstCompoundClause(target.replace(/\s+/g, " "));
      return { kind: "launch_app", app, rawName: shortName };
    }
  }

  return null;
}

export function isNativeAppCommand(command?: string | null): boolean {
  return parseNativeAppCommand(command) !== null;
}
