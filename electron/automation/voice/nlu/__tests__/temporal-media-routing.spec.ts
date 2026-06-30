import { describe, expect, it } from "vitest";
import { parseDesktopIntent } from "../pipeline.js";

describe("temporal image/video routing (P8)", () => {
  it("routes open image I opened yesterday to smart_search", () => {
    const intent = parseDesktopIntent("Open image I opened yesterday");
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      expect(intent.intent.query.type).toBe("time_ranged");
      if (intent.intent.query.type === "time_ranged") {
        expect(intent.intent.query.extension).toBe("image");
        expect(intent.intent.query.timeRange).toBe("yesterday");
      }
    }
  });

  it("routes open video I opened 2 months ago to smart_search", () => {
    const intent = parseDesktopIntent("Open video I opened 2 months ago");
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      expect(intent.intent.query.type).toBe("time_ranged");
      if (intent.intent.query.type === "time_ranged") {
        expect(intent.intent.query.extension).toBe("video");
      }
    }
  });

  it("does not treat open last image as temporal", () => {
    const intent = parseDesktopIntent("Open last image I opened");
    expect(intent?.intent.kind).toBe("recall_memory");
    if (intent?.intent.kind === "recall_memory") {
      expect(intent.intent.target).toBe("image");
    }
  });

  it("routes screen recording temporal open", () => {
    const intent = parseDesktopIntent(
      "Open screen recording I opened yesterday",
    );
    expect(intent?.intent.kind).toBe("smart_search");
    if (intent?.intent.kind === "smart_search") {
      expect(intent.intent.query.type).toBe("time_ranged");
      if (intent.intent.query.type === "time_ranged") {
        expect(intent.intent.query.extension).toBe("video");
      }
    }
  });
});
