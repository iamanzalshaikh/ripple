import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";
import {
  appendActivityLog,
  clearActivityLog,
  searchActivityByPhrase,
} from "../../../../storage/activityLog.js";
import {
  clearSemanticIndex,
  upsertSemanticIndex,
} from "../../../../storage/semanticIndex.js";
import {
  clearLifeEvents,
  upsertLifeEvent,
} from "../../../../storage/lifeEvents.js";
import { retrieveFileCandidates } from "../../../retriever/retriever.js";
import { ingestCrossAppReference } from "../../../../storage/crossAppIngest.js";
import { getRippleDb } from "../../../../storage/rippleDb.js";

useFreshNluCache();

beforeEach(() => {
  clearActivityLog();
  clearSemanticIndex();
  clearLifeEvents();
});

describe("P8b semantic voice routing", () => {
  it("routes open PDF I discussed with Ahmed to semantic smart_search", () => {
    const intent = parseDesktopIntent("Open PDF I discussed with Ahmed");
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      expect(intent.intent.query.type).toBe("semantic_topic");
      if (intent.intent.query.type === "semantic_topic") {
        expect(intent.intent.query.extension).toBe("pdf");
        expect(intent.intent.query.contactTopic?.toLowerCase()).toBe("ahmed");
      }
    }
  });

  it("routes before my Goa trip to semantic with life event topic", () => {
    const intent = parseDesktopIntent("Open pdf before my Goa trip");
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      expect(intent.intent.query.type).toBe("semantic_topic");
      if (intent.intent.query.type === "semantic_topic") {
        expect(intent.intent.query.lifeEventTopic?.toLowerCase()).toContain("goa");
      }
    }
  });

  it("routes remember my Goa trip was March 2025", () => {
    const intent = parseDesktopIntent("Remember my Goa trip was March 2025");
    expect(intent?.intent.kind).toBe("remember_life_event");
    if (intent?.intent.kind === "remember_life_event") {
      expect(intent.intent.topic).toContain("goa");
    }
  });

  it("retriever finds contact-linked pdf via semantic pass", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-p8b-"));
    const ahmedPdf = join(dir, "ahmed-proposal.pdf");
    const otherPdf = join(dir, "other.pdf");
    writeFileSync(ahmedPdf, "proposal for ahmed quarterly review");
    writeFileSync(otherPdf, "unrelated");

    appendActivityLog({
      path: ahmedPdf,
      contact: "ahmed",
      command: "Discussed proposal with Ahmed",
      summary: "ahmed-proposal.pdf",
    });
    upsertSemanticIndex({
      path: ahmedPdf,
      command: "Discussed with Ahmed",
      contact: "ahmed",
    });

    const hits = await retrieveFileCandidates({
      phrase: "Open PDF I discussed with Ahmed",
      extension: "pdf",
      contactTopic: "Ahmed",
    });

    expect(hits[0]?.path).toBe(ahmedPdf);
    expect(hits[0]?.source).toBe("semantic");
  });

  it("life event filter prefers files before trip date", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-p8b-life-"));
    const beforeTrip = join(dir, "goa-packing-list.pdf");
    const afterTrip = join(dir, "goa-photos.pdf");
    writeFileSync(beforeTrip, "packing list goa");
    writeFileSync(afterTrip, "goa photos after trip");

    const tripAt = new Date("2025-03-15T12:00:00.000Z").toISOString();
    upsertLifeEvent({
      label: "Goa trip",
      topic: "goa trip",
      eventAt: tripAt,
    });

    const beforeMs = new Date("2025-03-01T12:00:00.000Z").toISOString();
    getRippleDb()
      .prepare(
        `INSERT INTO activity_log (path, app_id, contact, command, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        beforeTrip,
        null,
        null,
        "viewed pdf (packing)",
        "goa-packing-list.pdf",
        beforeMs,
      );

    upsertSemanticIndex({ path: beforeTrip, command: "goa trip packing" });
    upsertSemanticIndex({ path: afterTrip, command: "goa trip photos" });

    const hits = await retrieveFileCandidates({
      phrase: "Open pdf before my Goa trip",
      extension: "pdf",
      lifeEventTopic: "Goa trip",
    });

    expect(hits.some((h) => h.path === beforeTrip)).toBe(true);
    expect(hits[0]?.path).not.toBe(afterTrip);
  });

  it("cross-app ingest links slack reference to activity", () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-p8b-slack-"));
    const path = join(dir, "sarah-contract.pdf");
    writeFileSync(path, "contract draft");

    ingestCrossAppReference({
      appId: "slack",
      summary: "Sarah shared contract draft",
      path,
      contact: "sarah",
      command: "slack message from Sarah",
    });

    const hits = searchActivityByPhrase("sarah shared contract");
    expect(hits).toContain(path);
  });
});
