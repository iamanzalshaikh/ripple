import type { WellKnownFolder } from "../../desktop/parseDesktopCommand.js";
import { parseFileOperationCommand } from "../../desktop/parseFileOperationCommand.js";
import type { NativeCommandIntent } from "../../desktop/parseNativeCommand.js";
import { parseNativeCommandStrict } from "../../desktop/parseNativeCommand.js";
import type { SmartSearchIntent } from "../../desktop/parseSmartSearchCommand.js";
import {
  folderIntentFromOpenTarget,
  parseWellKnownFolderOpen,
} from "../../desktop/folderIntent.js";
import { parseReferentialRecall } from "./referentialParse.js";
import { parseByIntentClassifier } from "./intentClassifier.js";
import { preprocessForNlu } from "./preprocess.js";

/** Web/app opens — never treat as desktop file search. */
const WEB_OR_APP_OPEN =
  /\b(?:open|show|find|pull\s+up)\s+(?:the\s+)?(?:app\s+)?(gmail|google\s*mail|whatsapp|notion|youtube|linkedin|instagram|chrome|firefox|edge|browser|slack|discord|spotify|facebook|twitter|mail|email)\b/i;

function isWebOrAppPhrase(cmd: string): boolean {
  return WEB_OR_APP_OPEN.test(cmd);
}

const FOLDER_ALIASES: Record<string, WellKnownFolder> = {
  download: "downloads",
  downloads: "downloads",
  document: "documents",
  documents: "documents",
  desktop: "desktop",
};

function folderKey(raw: string): WellKnownFolder | null {
  const key = raw.trim().toLowerCase().replace(/\s+for\s+me\s*$/i, "");
  return FOLDER_ALIASES[key] ?? null;
}

function parseCasualSmartSearch(cmd: string): SmartSearchIntent | null {
  const lower = cmd.toLowerCase();

  if (/\bwhatsapp\b/i.test(lower)) return null;

  if (
    /\b(?:last|most\s+recent|latest)\s+downloads?(?:ed)?(?:\s+file)?\b/i.test(
      lower,
    ) ||
    /\bwhat\s+did\s+I\s+download\b/i.test(lower) ||
    /\bshow\s+me\s+(?:my\s+)?(?:last|latest)\s+download\b/i.test(lower)
  ) {
    return {
      kind: "smart_search",
      query: { type: "last_downloaded" },
      label: "last_downloaded",
    };
  }

  if (
    /\b(?:find|get|show|open|search)\s+(?:me\s+)?(?:my\s+)?resume\b/i.test(lower)
  ) {
    return {
      kind: "smart_search",
      query: { type: "latest_token", token: "resume" },
      label: "my_resume",
    };
  }

  const latest = cmd.match(
    /\b(?:get|find|show|open)\s+(?:me\s+)?(?:the\s+)?latest\s+([\w\s-]+?)\s*$/i,
  );
  if (latest?.[1]) {
    const token = latest[1].trim().toLowerCase();
    if (token && !/^(file|folder|app|thing)$/i.test(token)) {
      return {
        kind: "smart_search",
        query: { type: "latest_token", token },
        label: `latest_${token.replace(/\s+/g, "_")}`,
      };
    }
  }

  if (
    /\byesterday'?s?\s+pdf\b/i.test(lower) ||
    /\bpdf\s+(?:from\s+)?yesterday\b/i.test(lower)
  ) {
    return {
      kind: "smart_search",
      query: { type: "modified_yesterday", extension: "pdf" },
      label: "yesterday_pdf",
    };
  }

  if (
    /\btomorrow'?s?\s+pdf\b/i.test(lower) ||
    /\bpdf\s+(?:from\s+)?tomorrow\b/i.test(lower) ||
    /\btoday'?s?\s+pdf\b/i.test(lower) ||
    /\bpdf\s+(?:from\s+)?today\b/i.test(lower)
  ) {
    return {
      kind: "smart_search",
      query: { type: "modified_today", extension: "pdf" },
      label: /\btomorrow\b/i.test(lower) ? "tomorrow_pdf" : "today_pdf",
    };
  }

  const nameSearch = cmd.match(/\bsearch\s+(?:for\s+)?(.+?)\s*$/i);
  if (nameSearch?.[1]) {
    const token = nameSearch[1].trim().toLowerCase();
    if (/\band\s+(?:say|text|message|ask)\b/.test(token)) return null;
    if (
      /\b(?:on|in|at)\s+(?:linkedin|instagram|youtube|notion|whatsapp|gmail|google\s*mail|facebook|twitter)\b/i.test(
        lower,
      ) ||
      /\b(?:linkedin|instagram|youtube|notion|whatsapp|gmail|slack|discord)\b/i.test(
        lower,
      )
    ) {
      return null;
    }
    if (/\bon\s+whatsapp\b/i.test(lower) || /\bwhatsapp\b/i.test(lower)) {
      return null;
    }
    if (token.length >= 2 && !/^(file|folder|app|thing)$/i.test(token)) {
      return {
        kind: "smart_search",
        query: { type: "latest_token", token },
        label: `search_${token.replace(/\s+/g, "_")}`,
      };
    }
  }

  return null;
}

function parseCasualOpen(cmd: string): NativeCommandIntent | null {
  const folderFirst = parseWellKnownFolderOpen(cmd);
  if (folderFirst) return folderFirst;

  const trimmed = cmd.trim();
  const openPrefix = /^(?:please\s+|kindly\s+)?(?:open|show)\s+(?:the\s+)?(?:my\s+)?/i;

  const folderOnly = trimmed.match(
    /^(?:please\s+|kindly\s+)?(?:open|show)\s+(?:the\s+)?(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
  );
  if (folderOnly?.[1]) {
    const folder = folderKey(folderOnly[1]);
    if (folder) return { kind: "folder", folder };
  }

  const itemInFolder = trimmed.match(
    /^(?:please\s+|kindly\s+)?(?:open|show|find)\s+(?:my\s+)?(.+?)\s+(?:in|on)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
  );
  if (itemInFolder?.[1] && itemInFolder[2]) {
    const folder = folderKey(itemInFolder[2]);
    if (folder) {
      return {
        kind: "item",
        name: itemInFolder[1].trim(),
        parent: folder,
      };
    }
  }

  if (!openPrefix.test(trimmed)) return null;

  const openNamed = trimmed.replace(openPrefix, "").trim();
  if (openNamed) {
    const asFolder = folderIntentFromOpenTarget(openNamed);
    if (asFolder) return asFolder;
    const folder = folderKey(openNamed);
    if (folder) return { kind: "folder", folder };
    if (openNamed.length >= 2) {
      return { kind: "item", name: openNamed };
    }
  }

  return null;
}

/**
 * NLU fallback after preprocess + strict parsers miss.
 * `nlu` is already normalizeTranscript + normalizeForNlu output.
 */
export function parseNluFallback(
  nlu: string,
  raw?: string,
): NativeCommandIntent | null {
  if (!nlu.trim()) return null;

  const referential = parseReferentialRecall(raw ?? nlu);
  if (referential) {
    console.info(
      `[ripple-desktop] NLU referential → recall:${referential.target}`,
    );
    return referential;
  }

  const fromNormalized = parseNativeCommandStrict(nlu);
  if (fromNormalized) {
    console.info(`[ripple-desktop] NLU strict retry → ${fromNormalized.kind}`);
    return fromNormalized;
  }

  const fileOp = parseFileOperationCommand(nlu);
  if (fileOp) {
    console.info(`[ripple-desktop] NLU file op → ${fileOp.kind}`);
    return fileOp;
  }

  const smart = parseCasualSmartSearch(nlu);
  if (smart) {
    console.info(`[ripple-desktop] NLU smart search → ${smart.label}`);
    return smart;
  }

  const casual = parseCasualOpen(nlu);
  if (casual && !isWebOrAppPhrase(nlu)) {
    console.info(`[ripple-desktop] NLU casual open → ${casual.kind}`);
    return casual;
  }

  const classified = parseByIntentClassifier(nlu);
  if (classified) {
    console.info(`[ripple-desktop] NLU classifier retry → ${classified.kind}`);
    return classified;
  }

  return null;
}

/** Back-compat wrapper — prefer parseDesktopIntent() from pipeline.ts */
export function parseNaturalDesktopCommand(
  command?: string | null,
): NativeCommandIntent | null {
  const { nlu, raw } = preprocessForNlu(command);
  return parseNluFallback(nlu, raw);
}
