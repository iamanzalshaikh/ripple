import { describe, expect, it } from "vitest";
import { parseDesktopIntent } from "../pipeline.js";
import { parseReferentialRecall } from "../referentialParse.js";

describe("temporal PDF routing (P8)", () => {
  it("does not treat time-based pdf open as recall:pdf", () => {
    expect(parseReferentialRecall("Open pdf I opened 2 months ago")).toBeNull();
    expect(parseReferentialRecall("Open pdf I opened last month")).toBeNull();
    expect(parseReferentialRecall("Open pdf I opened last week")).toBeNull();
  });

  it("does not recall lastpdf.io as last pdf", () => {
    const intent = parseDesktopIntent("Open lastpdf.io file");
    expect(intent?.intent.kind).not.toBe("recall_memory");
  });

  it("still recalls plain last pdf", () => {
    expect(parseReferentialRecall("open last pdf")?.target).toBe("pdf");
    expect(parseReferentialRecall("open the pdf I opened")?.target).toBe("pdf");
    expect(parseReferentialRecall("open last pdf I opened")?.target).toBe("pdf");
  });

  it("routes open last pdf I opened to recall_memory not temporal search", () => {
    const intent = parseDesktopIntent("Open last pdf I opened");
    expect(intent?.intent.kind).toBe("recall_memory");
    if (intent?.intent.kind === "recall_memory") {
      expect(intent.intent.target).toBe("pdf");
    }
  });

  it("routes temporal pdf open to smart_search", () => {
    const twoMonths = parseDesktopIntent("Open pdf I opened 2 months ago");
    expect(twoMonths?.intent.kind).toBe("smart_search");
    if (twoMonths?.intent.kind === "smart_search") {
      expect(twoMonths.intent.query.type).toBe("time_ranged");
    }

    const saturday = parseDesktopIntent("Open pdf, I open on last Saturday");
    expect(saturday?.intent.kind).toBe("smart_search");
  });
});
