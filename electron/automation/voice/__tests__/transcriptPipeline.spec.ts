import { describe, expect, it } from "vitest";
import { parseDesktopIntent } from "../nlu/pipeline.js";
import {
  commandTextFromTranscript,
  processTranscriptFromStt,
  transcriptDebugLabel,
} from "../transcriptPipeline.js";
import { containsDevanagari } from "../i18n/scriptDetect.js";
import { useFreshNluCache } from "../nlu/__tests__/testHelpers.js";

useFreshNluCache();

describe("transcriptPipeline — UTF-8 / mojibake", () => {
  it.each([
    ["Downloads kholo", /open downloads/i],
    ["डाउनलोड खोलो", /open downloads/i],
    ["मेरा फोल्डर खोलो", /open my folder/i],
    ["VS Code kholo", /vs code/i],
    ["Open Downloads", /open downloads/i],
  ])('"%s" → %s', (phrase, pattern) => {
    const snap = processTranscriptFromStt(phrase);
    expect(snap.nlu).toMatch(pattern);
    const intent = parseDesktopIntent(commandTextFromTranscript(snap));
    expect(intent).not.toBeNull();
  });

  it("repairs greek-alpha hindi mojibake to devanagari", () => {
    const garbled = "αñôαñªαñ¿ αñàαñ¿αÑìαñ£αñ▓";
    const snap = processTranscriptFromStt(garbled);
    expect(snap.wasMojibake || containsDevanagari(snap.repaired)).toBe(true);
    expect(snap.nlu).toMatch(/open\s+anzal/i);
  });

  it("debug label uses unicode code points", () => {
    const label = transcriptDebugLabel("डाउनलोड");
    expect(label).toContain("U+0921");
    expect(label).toContain("डाउनलोड");
  });
});
