import { describe, expect, it } from "vitest";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("temporal Hinglish/Urdu routing (P8)", () => {
  it("routes kal wali image kholo to yesterday image smart_search", () => {
    const intent = parseDesktopIntent("Kal wali image kholo");
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      expect(intent.intent.query.type).toBe("modified_yesterday");
      if (intent.intent.query.type === "modified_yesterday") {
        expect(intent.intent.query.extension).toBe("image");
      }
    }
  });

  it("routes kal wala video kholo to yesterday video smart_search", () => {
    const intent = parseDesktopIntent("Kal wala video kholo");
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      expect(intent.intent.query.type).toBe("modified_yesterday");
      if (intent.intent.query.type === "modified_yesterday") {
        expect(intent.intent.query.extension).toBe("video");
      }
    }
  });

  it("routes teen mahine pehle wali pdf to 3 months ago pdf", () => {
    const intent = parseDesktopIntent("Teen mahine pehle wali pdf kholo");
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      const q = intent.intent.query;
      if (q.type === "time_ranged") {
        expect(q.extension).toBe("pdf");
        expect(q.timeRange).toBe("3_months_ago");
      } else {
        expect(q.type).toBe("modified_3_months_ago");
        if (q.type === "modified_3_months_ago") {
          expect(q.extension).toBe("pdf");
        }
      }
    }
  });

  it("routes Roman Urdu kal wala video kholo", () => {
    const intent = parseDesktopIntent("kal wala video kholo");
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      expect(intent.intent.query.type).toBe("modified_yesterday");
      if (intent.intent.query.type === "modified_yesterday") {
        expect(intent.intent.query.extension).toBe("video");
      }
    }
  });

  it("does not treat kal wali image as last-image recall", () => {
    const intent = parseDesktopIntent("Kal wali image kholo");
    expect(intent?.intent.kind).not.toBe("recall_memory");
  });
});
