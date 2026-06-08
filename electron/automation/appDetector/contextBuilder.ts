import {
  focusContextToMetadata,
  getFocusContext,
  refreshFocusFromExtension,
  type FocusContext,
} from "../../focus/focusContext.js";
import { readClipboardText } from "../clipboard/clipboardService.js";
import { getCdpActiveTabUrl } from "../cdp/cdpClient.js";

export interface RippleContextMetadata {
  focused_app: string;
  window_title: string;
  action_source: string;
  input_type: string;
  browser?: string;
  os: string;
  url?: string;
  focus_hwnd?: number;
  notion_focused?: boolean;
  clipboard_available?: boolean;
  clipboard_char_count?: number;
  prefer_local_clipboard_paste?: boolean;
}

function mapInputType(ctx: FocusContext | null): string {
  if (!ctx) return "unknown";
  if (ctx.isGmail) return "email_body";
  if (ctx.isWhatsApp) return "chatbox";
  if (ctx.isSlack) return "chatbox";
  if (ctx.isNotion) return "document";
  if (ctx.isYouTube) return "search_box";
  if (ctx.isLinkedIn) return "editor";
  if (ctx.isInstagram) return "chatbox";
  if (ctx.isBrowser) return "unknown";
  return "text";
}

function mapFocusedApp(ctx: FocusContext | null): string {
  if (!ctx) return "unknown";
  if (ctx.isGmail) return "Gmail";
  if (ctx.isWhatsApp) return "WhatsApp";
  if (ctx.isSlack) return "Slack";
  if (ctx.isNotion) return "Notion";
  if (ctx.isYouTube) return "YouTube";
  if (ctx.isLinkedIn) return "LinkedIn";
  if (ctx.isInstagram) return "Instagram";
  if (ctx.isBrowser) return ctx.processName || "browser";
  return ctx.processName || "desktop";
}

/** Rich context for backend + workflow expansion (Phase 3.5). */
export async function buildContextMetadata(): Promise<RippleContextMetadata> {
  await refreshFocusFromExtension();
  const base = focusContextToMetadata();
  const ctx = getFocusContext();
  let url: string | undefined;

  try {
    url = await getCdpActiveTabUrl();
  } catch {
    url = undefined;
  }

  const clipLen = readClipboardText().length;

  return {
    focused_app: mapFocusedApp(ctx),
    window_title: (base.window_title as string) ?? ctx?.windowTitle ?? "",
    action_source: (base.action_source as string) ?? "desktop",
    input_type: mapInputType(ctx),
    browser: ctx?.isBrowser ? ctx.processName : undefined,
    os: process.platform,
    url,
    focus_hwnd: base.focus_hwnd as number | undefined,
    notion_focused: ctx?.isNotion === true,
    clipboard_available: clipLen > 0,
    clipboard_char_count: clipLen,
    prefer_local_clipboard_paste: ctx?.isNotion === true && clipLen > 0,
  };
}

/** Map focus metadata → backend context_type / action_source for AI prompts. */
export function resolveBackendContext(metadata?: Record<string, unknown>): {
  contextType: string;
  actionSource: string;
} {
  const actionSource =
    typeof metadata?.action_source === "string" ? metadata.action_source : "desktop";

  let contextType = "general";
  if (metadata?.notion_focused === true || actionSource === "notion") {
    contextType = "notion";
  } else if (actionSource === "gmail") {
    contextType = "email";
  } else if (actionSource === "whatsapp") {
    contextType = "whatsapp";
  } else if (actionSource === "slack") {
    contextType = "slack";
  } else if (actionSource === "youtube") {
    contextType = "general";
  } else if (actionSource === "linkedin") {
    contextType = "linkedin";
  } else if (actionSource === "instagram") {
    contextType = "instagram";
  }

  return { contextType, actionSource };
}
