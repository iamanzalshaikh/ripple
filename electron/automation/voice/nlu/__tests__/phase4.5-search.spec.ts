import { describe, expect, it } from "vitest";
import { parseSmartSearchCommand } from "../../../desktop/parseSmartSearchCommand.js";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Phase 4.5 — intelligent search", () => {
  it.each([
    ["Open my resume", "latest_token", "resume"],
    ["Open the last downloaded file", "last_downloaded", null],
    ["Open the last download file", "last_downloaded", null],
    ["Open the last downloads file", "last_downloaded", null],
    ["Open yesterday's pdf", "modified_yesterday", "pdf"],
    ["Open today's pdf", "modified_today", "pdf"],
    ["Open tomorrow's pdf", "modified_today", "pdf"],
    ["search Dr Fatima", "latest_token", "dr fatima"],
  ])('"%s" → query type %s', (cmd, queryType, token) => {
    const intent = parseSmartSearchCommand(cmd);
    expect(intent?.kind).toBe("smart_search");
    if (!intent) return;
    expect(intent.query.type).toBe(queryType);
    if (token && intent.query.type === "latest_token") {
      expect(intent.query.token).toBe(token);
    }
    if (token && intent.query.type === "modified_yesterday") {
      expect(intent.query.extension).toBe(token);
    }
    if (token && intent.query.type === "modified_today") {
      expect(intent.query.extension).toBe(token);
    }
  });

  it("edited yesterday token", () => {
    const intent = parseSmartSearchCommand(
      "Open the presentation I edited yesterday",
    );
    expect(intent?.query.type).toBe("edited_yesterday");
    if (intent?.query.type === "edited_yesterday") {
      expect(intent.query.token).toBe("presentation");
    }
  });

  it("pipeline: kal wali pdf via hinglish", () => {
    const result = parseDesktopIntent("Yaar kal wali pdf dikhao");
    expect(result?.intent.kind).toBe("smart_search");
  });

  it("pipeline: show me tomorrow's pdf is smart search not item filename", () => {
    const result = parseDesktopIntent("Show me tomorrow's pdf");
    expect(result?.intent.kind).toBe("smart_search");
    if (result?.intent.kind === "smart_search") {
      expect(result.intent.query.type).toBe("modified_today");
      expect(result.intent.label).toBe("tomorrow_pdf");
    }
  });

  it("does not steal LinkedIn people search", () => {
    expect(parseSmartSearchCommand("Search Anzal Sheikh on LinkedIn")).toBeNull();
    expect(parseSmartSearchCommand("Search FaceShake on LinkedIn")).toBeNull();
  });

  it("last download phrasing — not generic item search", () => {
    const result = parseDesktopIntent("Open the last download file");
    expect(result?.intent.kind).toBe("smart_search");
    if (result?.intent.kind === "smart_search") {
      expect(result.intent.query.type).toBe("last_downloaded");
    }
  });

  it("does not steal YouTube season search", () => {
    expect(parseSmartSearchCommand("Search Arzul Ghazi Season 1 Episode 4")).toBeNull();
  });
});
