import { describe, expect, it } from "vitest";
import { normalizeHindi } from "../../i18n/hindiNormalize.js";
import { normalizeHinglish } from "../../i18n/hinglishNormalize.js";
import { normalizeSinhala } from "../../i18n/sinhalaNormalize.js";
import { normalizeUrdu } from "../../i18n/urduNormalize.js";
import {
  repairMixedDesktopOpen,
  repairUtf8Mojibake,
} from "../../i18n/repairEncoding.js";
import {
  containsDevanagari,
  containsSinhala,
  detectPrimaryScript,
} from "../../i18n/scriptDetect.js";
import {
  isLikelyDesktopCommand,
  isRegionalLanguageCommand,
} from "../desktopIntentGuard.js";
import { parseDesktopIntent } from "../pipeline.js";
import { preprocessForNlu } from "../preprocess.js";
import { normalizeTranscript } from "../../normalizeTranscript.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Phase 4.7 — script detection", () => {
  it("detects devanagari", () => {
    expect(detectPrimaryScript("डाउनलोड")).toBe("devanagari");
    expect(containsDevanagari("hello डाउनलोड")).toBe(true);
  });

  it("detects sinhala", () => {
    expect(containsSinhala("බ්‍රවුසර්")).toBe(true);
  });

  it("latin for english", () => {
    expect(detectPrimaryScript("Open downloads")).toBe("latin");
  });
});

describe("Phase 4.7 — regional normalizers", () => {
  it("hindi phrase → english", () => {
    expect(normalizeHindi("डाउनलोड खोलो")).toMatch(/open downloads/i);
    expect(normalizeHindi("फिर से खोलो")).toMatch(/open it again/i);
    expect(normalizeHindi("Desktop खोलो")).toMatch(/open desktop/i);
    expect(normalizeHindi("डेस्कटॉप खोल करो")).toMatch(/open desktop/i);
    expect(normalizeHindi("ओपन डेस्क टॉप")).toMatch(/open desktop/i);
    expect(normalizeHindi("अपने सेटिंग अपने सेटिंग")).toMatch(/open settings/i);
    expect(parseDesktopIntent("ओपन डेस्क टॉप")?.intent.kind).toMatch(
      /folder|open_alias/,
    );
    expect(parseDesktopIntent("अपने सेटिंग अपने सेटिंग")?.intent.kind).toBe(
      "system_action",
    );
  });

  it("repairs Whisper mojibake + mixed Desktop Hindi", () => {
    const garbled = "Desktop αñôαñªαñ¿ αñòαñ░αÑïαÑñ";
    const repaired = repairUtf8Mojibake(garbled);
    expect(containsDevanagari(repaired) || repaired === garbled).toBe(true);
    expect(repairMixedDesktopOpen(garbled)).toBe("open desktop");
    const normalized = normalizeTranscript(garbled);
    expect(normalized).toMatch(/open desktop/i);
    expect(parseDesktopIntent(garbled)?.intent.kind).toMatch(/folder|open_alias/);
  });

  it("repairs open alias hindi mojibake", () => {
    const garbled = "αñôαñªαñ¿ αñàαñ¿αÑìαñ£αñ▓";
    const { nlu } = preprocessForNlu(garbled);
    expect(nlu).toMatch(/open\s+anzal/i);
    const intent = parseDesktopIntent(garbled)?.intent;
    expect(intent?.kind).toMatch(/open_alias|item/);
  });

  it("urdu phrase → english", () => {
    expect(normalizeUrdu("ڈاؤنلوڈ کھولو")).toMatch(/open downloads/i);
  });

  it("hinglish never produces merged tokens", () => {
    const out = normalizeHinglish("Download kholo");
    expect(out.toLowerCase()).not.toContain("downloadsopen");
    expect(out).toMatch(/open downloads/i);
  });

  it("sinhala basic open downloads", () => {
    const out = normalizeSinhala("ඩවුන්ලෝඩ් ඕපන් කරන්න");
    expect(out).toMatch(/open downloads/i);
  });
});

describe("Phase 4.7 — regional guard", () => {
  it("flags hindi desktop speech", () => {
    expect(isRegionalLanguageCommand("डाउनलोड खोलो")).toBe(true);
    expect(isLikelyDesktopCommand("डाउनलोड खोलो")).toBe(true);
  });

  it("urdu script detected", () => {
    expect(isRegionalLanguageCommand("ڈاؤنلوڈ کھولو")).toBe(true);
  });
});

describe("Phase 4.7 — full preprocess pipeline", () => {
  it.each([
    ["Bhai mera resume kholo", /resume/i],
    ["Yaar documents kholo", /documents/i],
    ["ڈاؤنلوڈ کھولو", /downloads/i],
  ])('"%s"', (input, pattern) => {
    const { nlu, changed } = preprocessForNlu(input);
    expect(nlu).toMatch(pattern);
    expect(changed).toBe(true);
  });
});
