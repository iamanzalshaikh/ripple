import { describe, expect, it } from "vitest";
import { preprocessForNlu } from "../preprocess.js";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

const CASES = [
  "क्रिएट फोल्डर इन डाउनलोड नेम फ्लो",
  "क्रिएट निव फोल्डर, नेम, फ्लवर्स, इन डाउनलोड",
  "क्रिएट करो एक new folder डाउनलोड में, इसका नाम होना चाहिए followers",
  "create karo ek folder downloads mein naam followers",
  "downloads mein folder banao naam followers",
  "क्रिएट करो फोल्डर डाउनलोड में नाम फ्लो",
];

describe("Hindi/Hinglish create folder", () => {
  for (const raw of CASES) {
    it(`parses: ${raw.slice(0, 40)}`, () => {
      const { nlu } = preprocessForNlu(raw);
      const intent = parseDesktopIntent(raw);
      expect(nlu.toLowerCase()).toMatch(/create|folder|named/);
      expect(intent?.intent.kind).toBe("create_folder");
    });
  }
});
