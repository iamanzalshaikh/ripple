import { describe, expect, it } from "vitest";
import { detectSpokenLanguage } from "../spokenLanguage.js";
import {
  spokenNotFound,
  spokenMissingParent,
} from "../spokenResponses.js";
import { normalizeUrduRoman } from "../urduNormalize.js";
import { useFreshNluCache } from "../../nlu/__tests__/testHelpers.js";

useFreshNluCache();

describe("P4 spoken language", () => {
  it("detects hinglish roman", () => {
    expect(detectSpokenLanguage("Bhai download kholo")).toBe("hinglish");
  });

  it("detects hindi devanagari", () => {
    expect(detectSpokenLanguage("डाउनलोड खोलो")).toBe("hindi");
  });

  it("detects urdu roman", () => {
    expect(detectSpokenLanguage("mujhe rizume kholo")).toBe("urdu");
  });

  it("returns hinglish not_found with examples", () => {
    const msg = spokenNotFound("kuch ajeeb command", "");
    expect(msg).toMatch(/samajh nahi aayi|Try|Aise bol/i);
    expect(msg).toMatch(/kholo/i);
  });

  it("returns english missing parent by default", () => {
    expect(spokenMissingParent("folder", "create folder")).toMatch(/Downloads/i);
  });
});

describe("P4 urdu roman normalize", () => {
  it("maps rizume kholo", () => {
    expect(normalizeUrduRoman("mera rizume kholo")).toMatch(/open my resume/i);
  });

  it("maps dastavez kholo", () => {
    expect(normalizeUrduRoman("dastavez kholo")).toMatch(/open documents/i);
  });
});
