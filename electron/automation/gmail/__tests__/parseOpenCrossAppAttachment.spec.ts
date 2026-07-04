import { describe, expect, it } from "vitest";
import { parseOpenCrossAppAttachmentCommand } from "../parseOpenCrossAppAttachment.js";
import { parseDesktopIntent } from "../../voice/nlu/pipeline.js";

describe("parseOpenCrossAppAttachmentCommand", () => {
  it("parses open pdf Ahmed sent", () => {
    const intent = parseOpenCrossAppAttachmentCommand("Open pdf Ahmed sent");
    expect(intent?.kind).toBe("open_cross_app_attachment");
    expect(intent?.extension).toBe("pdf");
    expect(intent?.contact).toBe("Ahmed");
  });

  it("parses open downloaded pdf", () => {
    const intent = parseOpenCrossAppAttachmentCommand("Open downloaded pdf");
    expect(intent?.extension).toBe("pdf");
  });

  it("parses open attachment from MongoDB Atlas", () => {
    const intent = parseOpenCrossAppAttachmentCommand(
      "Open attachment from MongoDB Atlas",
    );
    expect(intent?.contact).toBe("MongoDB Atlas");
    expect(intent?.extension).toBe("pdf");
  });

  it("does not steal gmail thread commands", () => {
    expect(
      parseOpenCrossAppAttachmentCommand("Open Gmail thread with pdf attached"),
    ).toBeNull();
  });

  it("does not steal semantic discussed commands", () => {
    expect(
      parseOpenCrossAppAttachmentCommand("Open PDF I discussed with Ahmed"),
    ).toBeNull();
  });

  it("does not steal open notepad type save workflow", () => {
    expect(
      parseOpenCrossAppAttachmentCommand(
        "Open notepad, type the following meeting notes and save the file as meetingnotes.txt inside my downloads",
      ),
    ).toBeNull();
  });

  it("routes via pipeline after gmail intents", () => {
    const parsed = parseDesktopIntent("Open pdf Ahmed sent");
    expect(parsed?.intent.kind).toBe("open_cross_app_attachment");
  });
});
