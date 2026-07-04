import { resolveNativeApp } from "../desktop/nativeAppRegistry.js";
import { firstCompoundClause } from "../voice/nlu/compoundParse.js";

export type OpenCrossAppAttachmentIntent = {
  kind: "open_cross_app_attachment";
  phrase: string;
  extension?: string;
  contact?: string;
};

const FILE_TYPES =
  "pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|csv|attachment|file";

const DESKTOP_WORKFLOW_CUES =
  /\b(?:notepad|calculator|wordpad|paint|chrome|firefox|edge)\b/i;

const DESKTOP_ACTION_CUES =
  /\b(?:type|write|dictate|save\s+(?:the\s+)?(?:file\s+)?as|meeting\s+notes|inside\s+(?:my\s+)?(?:downloads?|documents?|desktop))\b/i;

function isDesktopWorkflowOpen(cmd: string): boolean {
  if (DESKTOP_WORKFLOW_CUES.test(cmd)) return true;
  if (DESKTOP_ACTION_CUES.test(cmd)) return true;
  const openTarget = cmd.match(/^\s*open\s+(?:the\s+)?(?:app\s+)?(.+?)\s*$/i)?.[1];
  if (openTarget && resolveNativeApp(firstCompoundClause(openTarget))) {
    return true;
  }
  return false;
}

function isGmailRoutedCommand(cmd: string): boolean {
  if (/^\s*open\s+(?:a\s+|an\s+|the\s+)?(?:mail|email)s?\s+from\s+/i.test(cmd)) {
    return true;
  }
  const mentionsMail =
    /\bgmail\b/i.test(cmd) || /\b(?:mail|email)s?\b/i.test(cmd);
  const mentionsAttach =
    /\b(?:attachment|attached|attach)\b/i.test(cmd) ||
    /\bgmail\s+thread\b/i.test(cmd) ||
    /\bthread\s+with\b/i.test(cmd);
  if (mentionsMail && mentionsAttach) return true;
  if (
    mentionsMail &&
    (/\b(?:about|on|regarding|with\s+subject)\b/i.test(cmd) ||
      /^\s*open\s+(?:the\s+|a\s+|an\s+)?(.+?)\s+(?:mail|email)s?\s*$/i.test(cmd))
  ) {
    return true;
  }
  return false;
}

function isSemanticRecallCommand(cmd: string): boolean {
  return (
    /\bdiscussed\b/i.test(cmd) ||
    /\bthat thing\b/i.test(cmd) ||
    /\bbefore my\b/i.test(cmd) ||
    /\bremember\b/i.test(cmd)
  );
}

/** "Open pdf Ahmed sent", "Open downloaded pdf", "Open attachment from Ahmed". */
export function parseOpenCrossAppAttachmentCommand(
  command?: string | null,
): OpenCrossAppAttachmentIntent | null {
  const cmd = (command ?? "").trim();
  if (!/^\s*open\b/i.test(cmd)) return null;
  if (isGmailRoutedCommand(cmd)) return null;
  if (isSemanticRecallCommand(cmd)) return null;
  if (isDesktopWorkflowOpen(cmd)) return null;

  const extRe = new RegExp(`\\b(${FILE_TYPES})\\b`, "i");
  const extMatch = cmd.match(extRe);
  const hasAttachCue =
    /\b(?:attachment|attached|downloaded|saved)\b/i.test(cmd) ||
    !!extMatch;

  const sentMatch = cmd.match(
    new RegExp(
      `^\\s*open\\s+(?:the\\s+|a\\s+|an\\s+)?(?:(${FILE_TYPES})\\s+)?(.+?)\\s+sent\\s*$`,
      "i",
    ),
  );
  const possessiveMatch = cmd.match(
    new RegExp(`^\\s*open\\s+(.+?)'s\\s+(${FILE_TYPES})\\s*$`, "i"),
  );
  const fromMatch = cmd.match(
    /\b(?:attachment|file|pdf)\s+from\s+(.+?)\s*$/i,
  );

  if (!hasAttachCue && !sentMatch && !possessiveMatch && !fromMatch) {
    return null;
  }

  let contact: string | undefined;
  let extension: string | undefined;

  if (sentMatch?.[2]) {
    contact = sentMatch[2]
      .replace(/^(?:the|a|an)\s+/i, "")
      .trim();
    extension = sentMatch[1]?.toLowerCase();
  } else if (possessiveMatch) {
    contact = possessiveMatch[1]?.trim();
    extension = possessiveMatch[2]?.toLowerCase();
  } else if (fromMatch?.[1]) {
    contact = fromMatch[1].trim();
    extension = extMatch?.[1]?.toLowerCase();
  } else {
    extension = extMatch?.[1]?.toLowerCase();
    if (extension === "attachment" || extension === "file") {
      extension = "pdf";
    }
  }

  if (extension === "attachment" || extension === "file") {
    extension = "pdf";
  }

  return {
    kind: "open_cross_app_attachment",
    phrase: cmd,
    extension,
    contact,
  };
}
