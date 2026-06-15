import { isNotionFocused } from "../../../focus/focusContext.js";
import { isRememberWorkflowPhrase } from "../../desktop/spokenName.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";

export type NotionIntent =
  | { kind: "open"; workspace?: string }
  | {
      kind: "create_page";
      pasteClipboard: boolean;
      title?: string;
      body?: string;
      workspace?: string;
    };

export function wantsClipboard(cmd: string): boolean {
  return (
    /\bclipboard\b/i.test(cmd) ||
    /\bcopied\b/i.test(cmd) ||
    /\bwhat i (?:have )?copied\b/i.test(cmd) ||
    /\bpaste\s+(?:the\s+|my\s+)?(?:copy|clipboard)/i.test(cmd) ||
    /\bwhich i have copied\b/i.test(cmd) ||
    /\bhave copied\b/i.test(cmd)
  );
}

export function wantsPlaceCopied(cmd: string): boolean {
  return (
    (/\b(place|put)\b/i.test(cmd) && wantsClipboard(cmd)) ||
    (/\bplace\s+(?:the\s+)?thing\b/i.test(cmd) && /\bclipboard\b/i.test(cmd))
  );
}

export function wantsNotionDocumentation(cmd: string): boolean {
  return (
    /\b(create|write|make|generate|draft)\b/i.test(cmd) &&
    (/\b(documentation|document|docs?)\b/i.test(cmd) ||
      /\bfront[- ]?end\b/i.test(cmd) ||
      /\bback[- ]?end\b/i.test(cmd) ||
      (/\bentire\b/i.test(cmd) && /\bfor\b/i.test(cmd)))
  );
}

/** Only when user explicitly wants a new Notion page (notion.new). */
export function wantsExplicitNewPage(cmd: string): boolean {
  return (
    /\bnew\s+page\b/i.test(cmd) ||
    /\bcreate\s+(?:a\s+)?(?:new\s+)?page\b/i.test(cmd) ||
    /\bcreate\s+(?:a\s+)?notion\s+page\b/i.test(cmd) ||
    /\bnotion\.new\b/i.test(cmd)
  );
}

/** @deprecated use wantsExplicitNewPage */
export function wantsCreatePage(cmd: string): boolean {
  return wantsExplicitNewPage(cmd);
}

/** Write doc on current Notion page — backend generates + INSERT_TEXT. */
export function isNotionSamePageDocCommand(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return false;
  if (!isNotionFocused() && !mentionsNotion(cmd)) return false;
  if (wantsExplicitNewPage(cmd)) return false;
  if (wantsPlaceCopied(cmd) || wantsClipboard(cmd)) return false;
  return wantsNotionDocumentation(cmd);
}

/** On a Notion tab, intents that use local notion.new (not backend generation). */
export function isContextualNotionVoiceCommand(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd || !isNotionFocused()) return false;
  return (
    wantsExplicitNewPage(cmd) ||
    wantsPlaceCopied(cmd) ||
    (wantsClipboard(cmd) && /\b(paste|place|put)\b/i.test(cmd))
  );
}

function cleanNotionTitle(raw: string): string | undefined {
  let t = raw
    .trim()
    .replace(/\s+for\s+(?:me|development(?:\s+point of view)?)\s*$/i, "")
    .replace(/[.,;]+$/, "")
    .trim();
  if (t.length < 1) return undefined;
  return t.slice(0, 120);
}

export function extractNotionWorkspace(cmd: string): string | undefined {
  const m =
    cmd.match(/\bnotion\s+workspace\s+(.+?)(?:\s+and\b|\s+titled\b|\s+title\b|\s+saying\b|$)/i) ??
    cmd.match(/\bworkspace\s+(.+?)(?:\s+and\b|\s+titled\b|\s+title\b|\s+saying\b|$)/i);
  const name = m?.[1]?.trim().replace(/[.,;]+$/, "");
  return name && name.length >= 1 ? name.slice(0, 80) : undefined;
}

export function extractNotionTitle(cmd: string): string | undefined {
  const patterns = [
    /\bnotion\s+page\.?\s*title\s+(.+?)\.?\s*$/i,
    /\bpage\.?\s*title\s+(.+?)\.?\s*$/i,
    /\b(?:in|into)\s+(.+?)\s+title\s+(?:one|1)\b/i,
    /\b(.+?)\s+title\s+(?:one|1)\s*\.?\s*$/i,
    /\b(?:in|into)\s+(.+?)\s+titled\s+/i,
    /\btitled\s+(.+?)(?:\s+and\s+(?:say|paste|write)\b|\s+saying\b|\s+with\b|$)/i,
    /\btitle\s+(.+?)(?:\s+and\s+(?:say|paste|write)\b|\s+saying\b|\s+with\b|$)/i,
    /\bcalled\s+(.+?)(?:\s+and\s+(?:say|paste|write)\b|\s+saying\b|$)/i,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    const t = cleanNotionTitle(m?.[1] ?? "");
    if (t) return t;
  }
  return undefined;
}

export function extractNotionBody(cmd: string): string | undefined {
  const patterns = [
    /\b(?:saying|say)\s+(.+)$/i,
    /\bwith\s+(?:body|text|content)\s+(.+)$/i,
    /\band\s+(?:say|write)\s+(.+)$/i,
    /\bpaste\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    let b = m?.[1]?.trim().replace(/[.,;]+$/, "");
    if (!b) continue;
    if (/^clipboard\b/i.test(b)) continue;
    if (/^my\b/i.test(b) && /\bclipboard\b/i.test(b)) continue;
    if (b.length >= 1) return b;
  }
  return undefined;
}

function mentionsNotion(cmd: string): boolean {
  return /\bnotion\b/i.test(cmd) || /\bcreate\s+(?:a\s+)?notion\b/i.test(cmd);
}

function buildCreatePageIntent(cmd: string): NotionIntent {
  return {
    kind: "create_page",
    pasteClipboard: wantsClipboard(cmd) || wantsPlaceCopied(cmd),
    title: extractNotionTitle(cmd),
    body: extractNotionBody(cmd),
  };
}

/** Voice commands for Notion (B3 + 3.5.3). */
export function parseNotionCommand(command?: string | null): NotionIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  // "Remember study mode, open notion..." is a desktop workflow — not Notion open
  if (isRememberWorkflowPhrase(cmd)) return null;

  const onNotion = isNotionFocused();
  const saidNotion = mentionsNotion(cmd);

  // Doc on current page → backend (not local notion.new)
  if (isNotionSamePageDocCommand(cmd)) return null;

  if (onNotion && wantsExplicitNewPage(cmd) && !saidNotion) {
    return buildCreatePageIntent(cmd);
  }

  if (onNotion && (wantsPlaceCopied(cmd) || (wantsClipboard(cmd) && wantsExplicitNewPage(cmd)))) {
    return buildCreatePageIntent(cmd);
  }

  if (!saidNotion) return null;

  const workspace = extractNotionWorkspace(cmd);
  const paste =
    wantsClipboard(cmd) ||
    wantsPlaceCopied(cmd) ||
    /\b(paste|clipboard|copied)\b/i.test(cmd);

  if (/^\s*open\s+notion(?:\s+workspace\s+.+)?\s*\.?\s*$/i.test(cmd)) {
    return { kind: "open", workspace };
  }

  if (wantsExplicitNewPage(cmd) || wantsPlaceCopied(cmd) || (paste && wantsExplicitNewPage(cmd))) {
    return {
      kind: "create_page",
      pasteClipboard: paste,
      title: extractNotionTitle(cmd),
      body: extractNotionBody(cmd),
      workspace,
    };
  }

  if (/\bopen\s+notion\b/i.test(cmd)) {
    return { kind: "open", workspace };
  }

  return null;
}

export function isNotionCommand(command?: string | null): boolean {
  return parseNotionCommand(command) !== null;
}
