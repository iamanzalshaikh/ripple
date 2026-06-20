import { describe, expect, it } from "vitest";
import { preprocessForNlu } from "../../nlu/preprocess.js";
import { parseDesktopIntent } from "../../nlu/pipeline.js";
import { repairCorruptedTranscript } from "../repairEncoding.js";
import { useFreshNluCache } from "../../nlu/__tests__/testHelpers.js";

useFreshNluCache();

/** Real UTF-8 Hindi mis-decoded as Latin-1 (what Whisper/socket may deliver). */
const HINDI_CREATE =
  "क्रिएट फोल्डर इन डाउनलोड नेम फ्लो";
const MOJIBAKE_CREATE = Buffer.from(HINDI_CREATE, "utf8").toString("latin1");

const MIXED_CREATE =
  "क्रिएट करो एक new folder डाउनलोड में, इसका नाम होना चाहिए followers";
const MOJIBAKE_MIXED = Buffer.from(MIXED_CREATE, "utf8").toString("latin1");

describe("live mojibake from user logs", () => {
  it("repairs latin1 hindi create folder", () => {
    const fixed = repairCorruptedTranscript(MOJIBAKE_CREATE);
    expect(fixed).not.toBe(MOJIBAKE_CREATE);
    expect(fixed).toMatch(/फोल्डर|create|folder/i);
  });

  it("parses repaired hindi create folder", () => {
    const fixed = repairCorruptedTranscript(MOJIBAKE_CREATE);
    const { nlu } = preprocessForNlu(fixed);
    const intent = parseDesktopIntent(fixed);
    expect(nlu.toLowerCase()).toMatch(/create|folder|named/);
    expect(intent?.intent.kind).toBe("create_folder");
  });

  it("repairs mixed hindi-english create folder", () => {
    const fixed = repairCorruptedTranscript(MOJIBAKE_MIXED);
    expect(fixed).toMatch(/क्रिएट|create|folder|followers/i);
    const intent = parseDesktopIntent(fixed);
    expect(intent?.intent.kind).toBe("create_folder");
  });
});
