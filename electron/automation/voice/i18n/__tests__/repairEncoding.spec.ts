import { describe, expect, it } from "vitest";
import {
  looksLikeBoxDrawingMojibake,
  repairCorruptedTranscript,
  repairCp437Utf8Mojibake,
} from "../repairEncoding.js";

describe("repairCorruptedTranscript", () => {
  it("repairs Peaky Blinders CP437 mojibake", () => {
    const mojibake =
      "╪│╪▒┌å ┘╛█î┌⌐█î ╪¿┘ä╪º╪ª┘å┌ê╪▒╪▓ ╪│█î╪▓┘å 1 ╪º┘╛█î╪│┘ê┌ê 4 ╪º┘ê┘å █î┘ê┘╣┘ê╪¿";
    const fixed = repairCorruptedTranscript(mojibake);
    expect(fixed).toMatch(/پیکی|سرچ/);
  });

  it("repairs CP437 box-drawing Urdu from Whisper/Windows console", () => {
    const mojibake = "╪│╪▒┌å ┘ü█î╪╢ ╪│█î╪» ╪º┘ê┘å ┘ä┘å┌»┌ê█î┘å";
    expect(looksLikeBoxDrawingMojibake(mojibake)).toBe(true);
    const fixed = repairCp437Utf8Mojibake(mojibake);
    expect(fixed).toMatch(/سرچ/);
    expect(fixed).toMatch(/فیض/);
    expect(repairCorruptedTranscript(mojibake)).toMatch(/سرچ/);
  });

  it("repairs Greek-alpha Hindi mojibake", () => {
    const hindi = "क्रिएट करो, नया फोल्डर नेम अंजल डॉक्यूमेंट्स";
    const mojibake = Buffer.from(hindi, "utf8").toString("latin1");
    expect(looksLikeBoxDrawingMojibake(mojibake)).toBe(false);
    const fixed = repairCorruptedTranscript(mojibake);
    expect(fixed).toMatch(/करो|फोल्डर|डॉक्यूमेंट्स/);
  });

  it("repairs box-drawing Urdu mojibake", () => {
    const urdu = "جو پریویس ورک موو اسکورت نکال دو";
    const mojibake = Buffer.from(urdu, "utf8").toString("latin1");
    const fixed = repairCorruptedTranscript(mojibake);
    expect(fixed).toMatch(/جو|پریویس|ورک|موو/);
  });

  it("leaves clean English unchanged", () => {
    const s = "Create folder named Anzal in documents";
    expect(repairCorruptedTranscript(s)).toBe(s);
  });
});
