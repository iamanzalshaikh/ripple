import { describe, expect, it } from "vitest";
import {
  looksLikeBoxDrawingMojibake,
  repairCorruptedTranscript,
  repairCp437Utf8Mojibake,
} from "../repairEncoding.js";

const USER_MOJIBAKE =
  "╪│╪▒┌å ╪»┌⌐┘╣╪▒ ┘ü╪º╪╖┘à█ü ╪º┘ê╪▒ ┘╛┘ê┌å┌╛ ╪│┌⌐╪¬█Æ █ü█î┌║ ┌⌐█ü ╪ó┘╛ ┌⌐█î╪│█Æ █ü█î┌║╪ƒ";

describe("repairEncoding — Dr Fatima demo mojibake", () => {
  it("detects box-drawing mojibake", () => {
    expect(looksLikeBoxDrawingMojibake(USER_MOJIBAKE)).toBe(true);
  });

  it("repairs to Urdu or English search phrase", () => {
    const cp437 = repairCp437Utf8Mojibake(USER_MOJIBAKE);
    const fixed = repairCorruptedTranscript(USER_MOJIBAKE);
    const pick = fixed !== USER_MOJIBAKE ? fixed : cp437;
    expect(looksLikeBoxDrawingMojibake(pick)).toBe(false);
    expect(pick).toMatch(/سرچ|search/i);
    expect(pick).toMatch(/فاطمہ|fatima/i);
  });
});
