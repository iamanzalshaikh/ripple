import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import { isWhatsAppTabActive } from "../../focus/focusContext.js";
import {
  isTemporalFileOpenQuery,
  parseExtensionFromText,
  parseParentFolderFromText,
  parseTimeRangeFromText,
} from "../retriever/timeRange.js";
import { parseSemanticOpenCommand } from "../retriever/parseSemanticOpen.js";

export type SmartSearchQuery =
  | { type: "last_downloaded" }
  | { type: "latest_token"; token: string }
  | { type: "modified_yesterday"; extension?: string }
  | { type: "modified_today"; extension?: string }
  | { type: "modified_last_week"; extension?: string; token?: string }
  | { type: "modified_3_months_ago"; extension?: string; token?: string }
  | { type: "edited_yesterday"; token: string }
  | {
      type: "time_ranged";
      extension?: string;
      timeRange?: import("../retriever/timeRange.js").TimeRangeId;
      parentFolder?: string;
      command: string;
    }
  | {
      type: "semantic_topic";
      phrase: string;
      extension?: string;
      lifeEventTopic?: string;
      contactTopic?: string;
    };

export type SmartSearchIntent = {
  kind: "smart_search";
  query: SmartSearchQuery;
  label: string;
};

/**
 * Phase 4.5 — context/file search by voice (index-backed).
 */
export function parseSmartSearchCommand(
  command?: string | null,
): SmartSearchIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  if (/\bwhatsapp\b/i.test(cmd)) return null;

  const semanticOpen = parseSemanticOpenCommand(cmd);
  if (semanticOpen) {
    const tag =
      semanticOpen.lifeEventTopic ??
      semanticOpen.contactTopic ??
      "topic";
    return {
      kind: "smart_search",
      query: {
        type: "semantic_topic",
        phrase: semanticOpen.phrase,
        extension: semanticOpen.extension,
        lifeEventTopic: semanticOpen.lifeEventTopic,
        contactTopic: semanticOpen.contactTopic,
      },
      label: `semantic_${tag.replace(/\s+/g, "_").slice(0, 40)}`,
    };
  }

  if (/^\s*open\b/i.test(cmd) && isTemporalFileOpenQuery(cmd)) {
    const extension = parseExtensionFromText(cmd);
    const timeRange = parseTimeRangeFromText(cmd) ?? undefined;
    const parentFolder = parseParentFolderFromText(cmd);
    if (extension || timeRange) {
      return {
        kind: "smart_search",
        query: {
          type: "time_ranged",
          extension,
          timeRange: timeRange ?? undefined,
          parentFolder,
          command: cmd,
        },
        label: `temporal_${extension ?? "file"}`,
      };
    }
  }

  if (isWhatsAppTabActive()) {
    const looseSearch = cmd.match(/^\s*search\s+(?:for\s+)?(.+?)\s*$/i);
    if (
      looseSearch?.[1] &&
      !/\b(?:file|folder|resume|download|document|desktop|pdf)\b/i.test(cmd)
    ) {
      return null;
    }
  }

  if (
    /\b(?:search|find)\s+.+\s+and\s+(?:say|text|message|ask)\b/i.test(cmd)
  ) {
    return null;
  }

  if (
    /\b(?:last|most\s+recent|latest)\s+downloads?(?:ed)?(?:\s+file)?\b/i.test(
      cmd,
    ) ||
    /^\s*open\s+(?:my\s+)?most\s+recent\s+download\s*$/i.test(cmd)
  ) {
    return {
      kind: "smart_search",
      query: { type: "last_downloaded" },
      label: "last_downloaded",
    };
  }

  if (/^\s*open\s+my\s+resume\s*$/i.test(cmd)) {
    return {
      kind: "smart_search",
      query: { type: "latest_token", token: "resume" },
      label: "my_resume",
    };
  }

  const latestToken = cmd.match(
    /^\s*open\s+(?:my\s+)?latest\s+(\w[\w\s-]{0,24}?)\s*$/i,
  );
  if (latestToken?.[1]) {
    const token = latestToken[1].trim().toLowerCase();
    if (token && !/^(file|folder|app)$/i.test(token)) {
      return {
        kind: "smart_search",
        query: { type: "latest_token", token },
        label: `latest_${token}`,
      };
    }
  }

  const yesterdayPdf =
    /^\s*open\s+(?:the\s+)?yesterday'?s?\s+pdf\s*$/i.test(cmd) ||
    /^\s*open\s+(?:the\s+)?pdf\s+(?:from\s+)?yesterday\s*$/i.test(cmd);
  if (yesterdayPdf) {
    return {
      kind: "smart_search",
      query: { type: "modified_yesterday", extension: "pdf" },
      label: "yesterday_pdf",
    };
  }

  const editedYesterday = cmd.match(
    /^\s*open\s+(?:the\s+)?(.+?)\s+(?:I\s+)?edited\s+yesterday\s*$/i,
  );
  if (editedYesterday?.[1]?.trim()) {
    const token = stripSearchToken(editedYesterday[1]);
    return {
      kind: "smart_search",
      query: { type: "edited_yesterday", token },
      label: `edited_yesterday_${token}`,
    };
  }

  const tomorrowPdf =
    /^\s*open\s+(?:the\s+)?tomorrow'?s?\s+pdf\s*$/i.test(cmd) ||
    /^\s*open\s+(?:the\s+)?pdf\s+(?:from\s+)?tomorrow\s*$/i.test(cmd);
  if (tomorrowPdf) {
    return {
      kind: "smart_search",
      query: { type: "modified_today", extension: "pdf" },
      label: "tomorrow_pdf",
    };
  }

  const todayPdf =
    /^\s*open\s+(?:the\s+)?today'?s?\s+pdf\s*$/i.test(cmd) ||
    /^\s*open\s+(?:the\s+)?today\s+pdf\s*$/i.test(cmd) ||
    /^\s*open\s+(?:today'?s?\s+)?pdf\s*$/i.test(cmd);
  if (todayPdf) {
    return {
      kind: "smart_search",
      query: { type: "modified_today", extension: "pdf" },
      label: "today_pdf",
    };
  }

  const lastWeekPdf = cmd.match(
    /^\s*open\s+(?:the\s+)?pdf\s+(?:I\s+)?(?:edited|worked\s+on|opened)\s+last\s+week\s*$/i,
  );
  if (lastWeekPdf) {
    return {
      kind: "smart_search",
      query: { type: "modified_last_week", extension: "pdf" },
      label: "last_week_pdf",
    };
  }

  const threeMonthsPdf =
    /^\s*open\s+(?:the\s+)?pdf\s+(?:I\s+)?(?:edited|worked\s+on)\s+(?:3|three)\s+months?\s+ago\s*$/i.test(
      cmd,
    ) ||
    /\bopen\s+(?:the\s+)?pdf\s+(?:I\s+)?(?:edited|worked\s+on)\s+(?:3|three)\s+months?\s+ago\b/i.test(
      cmd,
    );
  if (threeMonthsPdf) {
    return {
      kind: "smart_search",
      query: { type: "modified_3_months_ago", extension: "pdf" },
      label: "3_months_pdf",
    };
  }

  const kalPdf =
    /^\s*(?:open\s+)?(?:kal|yesterday)(?:'s)?\s+(?:wali|ki|wala|ka)?\s*pdf\s*$/i.test(cmd) ||
    /^\s*(?:kal|yesterday)\s+(?:wali|ki|wala|ka)\s+pdf\s+(?:kholo|open)\s*$/i.test(cmd);
  if (kalPdf) {
    return {
      kind: "smart_search",
      query: { type: "modified_yesterday", extension: "pdf" },
      label: "kal_pdf",
    };
  }

  const kalImage =
    /^\s*(?:open\s+)?(?:kal|yesterday)(?:'s)?\s+(?:wali|ki|wala|ka)?\s*(?:image|photo|picture)\s*$/i.test(
      cmd,
    ) ||
    /^\s*(?:kal|yesterday)\s+(?:wali|ki|wala|ka)\s+(?:image|photo|picture)\s+(?:kholo|open)\s*$/i.test(
      cmd,
    );
  if (kalImage) {
    return {
      kind: "smart_search",
      query: { type: "modified_yesterday", extension: "image" },
      label: "kal_image",
    };
  }

  const kalVideo =
    /^\s*(?:open\s+)?(?:kal|yesterday)(?:'s)?\s+(?:wali|ki|wala|ka)?\s*video\s*$/i.test(cmd) ||
    /^\s*(?:kal|yesterday)\s+(?:wali|ki|wala|ka)\s+video\s+(?:kholo|open)\s*$/i.test(cmd);
  if (kalVideo) {
    return {
      kind: "smart_search",
      query: { type: "modified_yesterday", extension: "video" },
      label: "kal_video",
    };
  }

  const kalFolder =
    /^\s*(?:open\s+)?(?:kal|yesterday)(?:'s)?\s+(?:wali|ki|wala|ka)?\s*folder\s*$/i.test(cmd) ||
    /^\s*(?:kal|yesterday)\s+(?:wali|ki|wala|ka)\s+folder\s+(?:kholo|open)\s*$/i.test(cmd);
  if (kalFolder) {
    return {
      kind: "smart_search",
      query: {
        type: "time_ranged",
        extension: undefined,
        timeRange: "yesterday",
        command: cmd,
      },
      label: "kal_folder",
    };
  }

  const teenMahineMedia = cmd.match(
    /^\s*(?:open\s+)?(?:teen|3|three)\s+mahine?\s+(?:pehle|pahle)\s+(?:wali|wala|ki|ka)\s+(pdf|image|photo|video)\s*$/i,
  );
  if (teenMahineMedia?.[1]) {
    const raw = teenMahineMedia[1].toLowerCase();
    const extension =
      raw === "photo" ? "image" : (raw as "pdf" | "image" | "video");
    return {
      kind: "smart_search",
      query: { type: "modified_3_months_ago", extension },
      label: `teen_mahine_${extension}`,
    };
  }

  const aajPdf =
    /^\s*(?:open\s+)?(?:aaj|today)(?:'s)?\s+(?:wali|ki)?\s*pdf\s*$/i.test(cmd) ||
    /^\s*(?:aaj|today)\s+(?:wali|ki)\s+pdf\s+(?:kholo|open)\s*$/i.test(cmd);
  if (aajPdf) {
    return {
      kind: "smart_search",
      query: { type: "modified_today", extension: "pdf" },
      label: "aaj_pdf",
    };
  }

  const looseThreeMonths = cmd.match(
    /\bopen\s+(?:the\s+)?(.+?\s+)?(?:pdf|image|photo|video|file).{0,40}?(?:3|three|teen)\s+months?\s+(?:ago|pehle|pahle)\b/i,
  );
  if (looseThreeMonths) {
    const extMatch = cmd.match(/\b(pdf|image|photo|video)\b/i);
    const raw = extMatch?.[1]?.toLowerCase();
    const extension =
      raw === "photo" ? "image" : raw === "pdf" || raw === "video" ? raw : "pdf";
    return {
      kind: "smart_search",
      query: { type: "modified_3_months_ago", extension },
      label: `3_months_${extension}`,
    };
  }

  const nameSearch = cmd.match(/^\s*search\s+(?:for\s+)?(.+?)\s*$/i);
  if (nameSearch?.[1]) {
    const token = nameSearch[1].trim().toLowerCase();
    if (/\band\s+(?:say|text|message|ask)\b/.test(token)) return null;
    if (
      /\b(?:season|episode|ep\s*\d|s\d+\s*e\d+|trailer|movie|song|video|watch|play)\b/i.test(
        cmd,
      ) ||
      /(?:سیزن|سیریز|اپیسو[ڈدٹ])/u.test(cmd)
    ) {
      return null;
    }
    if (
      /\b(?:on|in|at)\s+(?:linkedin|instagram|youtube|notion|whatsapp|gmail|google\s*mail|facebook|twitter)\b/i.test(
        cmd,
      )
    ) {
      return null;
    }
    if (
      /\b(?:linkedin|instagram|youtube|notion|whatsapp|gmail|slack|discord)\b/i.test(
        cmd,
      )
    ) {
      return null;
    }
    if (token.length >= 2) {
      return {
        kind: "smart_search",
        query: { type: "latest_token", token },
        label: `search_${token.replace(/\s+/g, "_")}`,
      };
    }
  }

  return null;
}

/** Strip filler words from "presentation I edited yesterday". */
function stripSearchToken(raw: string): string {
  return raw
    .replace(/\b(the|my|a|an)\b/gi, "")
    .trim()
    .toLowerCase();
}
