/**
 * Simulates Mic → Whisper → normalizeTranscript → NLU → intent.
 * Real Whisper STT is tested separately in live-smoke (backend).
 */
import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../../normalizeTranscript.js";
import { parseDesktopIntent } from "../pipeline.js";
import { preprocessForNlu } from "../preprocess.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

type VoiceCase = {
  /** Raw text as Whisper might return */
  whisper: string;
  /** Expected intent kind, or null if should not parse desktop */
  kind: string | null;
  note?: string;
};

function runVoicePipeline(whisper: string) {
  const normalized = normalizeTranscript(whisper);
  const pre = preprocessForNlu(normalized);
  const parsed = parseDesktopIntent(normalized);
  return { normalized, nlu: pre.nlu, parsed };
}

describe("Voice pipeline — Whisper garbage → desktop intent", () => {
  const cases: VoiceCase[] = [
    { whisper: "Download kholo.", kind: "folder" },
    { whisper: "Download kholo and resume open karo mera.", kind: "compound" },
    { whisper: "Download karo aur open mera resume", kind: "compound" },
    { whisper: "Upon downloads", kind: "folder", note: "Whisper mishear" },
    { whisper: "Download open for me", kind: "folder", note: "scrambled" },
    { whisper: "OpenResume.pdf", kind: "file", note: "glued open" },
    { whisper: "Open setting", kind: "system_action", note: "singular settings" },
    { whisper: "Bhai mera resume kholo", kind: "smart_search" },
    {
      whisper: "Mara resume colo.",
      kind: "smart_search",
      note: "Whisper hears mera as Mara, kholo as colo",
    },
    { whisper: "Yaar kal wali pdf dikhao", kind: "smart_search" },
    { whisper: "Open WhatsApp.", kind: null, note: "web app not desktop folder" },
    { whisper: "Write me an email to boss", kind: null },
    { whisper: "डाउनलोड खोलो", kind: "folder" },
    { whisper: "व्हाट्सएप खोलो", kind: null },
    { whisper: "Remember, work mode, open VS Code", kind: "remember_workflow" },
    { whisper: "Move, invoice.pdf to, desktop", kind: "move_file" },
    { whisper: "Open it again", kind: "recall_memory" },
    { whisper: "Same file again", kind: "recall_memory" },
    { whisper: "Search Ammi1 and say how are you", kind: null, note: "whatsapp" },
    { whisper: "search me one and say hello", kind: null, note: "Whisper contact fix" },
  ];

  it.each(cases.map((c) => [c.whisper, c.kind, c.note ?? ""] as const))(
    'Whisper: "%s" → %s',
    (whisper, expectedKind) => {
      const { parsed, nlu } = runVoicePipeline(whisper);
      if (expectedKind === null) {
        expect(parsed?.intent.kind ?? null).toBeNull();
      } else {
        expect(parsed?.intent.kind).toBe(expectedKind);
      }
      expect(nlu.length).toBeGreaterThan(0);
    },
  );
});

describe("Voice pipeline — normalizeTranscript fixes", () => {
  it.each([
    ["open download", "Open downloads"],
    ["Upon my downloads", "Open downloads"],
    ["Open desktop for me", "Open desktop"],
    ["goodnight", "Good night"],
    ["whats app", "WhatsApp"],
    ["Mara resume colo.", "Open my resume"],
    ["Download colo", "Open downloads"],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalizeTranscript(input)).toBe(expected);
  });
});
