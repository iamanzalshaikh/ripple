import { describe, expect, it } from "vitest";
import { parseDesktopIntent } from "../pipeline.js";
import { preprocessForNlu } from "../preprocess.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

/**
 * Phone / Hinglish / regional slang matrix — NOT exhaustive (natural language is infinite).
 * Each case documents expected local parse behavior.
 */
type SlangCase = {
  phrase: string;
  shouldParse: boolean;
  kind?: string;
};

const SLANG_MATRIX: SlangCase[] = [
  // --- fillers + downloads ---
  { phrase: "Bhai download kholo", shouldParse: true, kind: "folder" },
  { phrase: "Yaar downloads kholo", shouldParse: true, kind: "folder" },
  { phrase: "Sun documents kholo", shouldParse: true, kind: "folder" },
  { phrase: "Dekho desktop kholo", shouldParse: true, kind: "folder" },
  { phrase: "Plz open downloads", shouldParse: true, kind: "folder" },
  { phrase: "Download kar do", shouldParse: true, kind: "folder" },
  { phrase: "Downloads khol do", shouldParse: true, kind: "folder" },
  { phrase: "Documents karo", shouldParse: true, kind: "folder" },

  // --- mera / resume ---
  { phrase: "Mera resume kholo", shouldParse: true, kind: "smart_search" },
  { phrase: "Meri resume dikhao", shouldParse: true, kind: "smart_search" },
  { phrase: "Mere resume open karo", shouldParse: true, kind: "smart_search" },
  { phrase: "Bhai mera resume kholo na", shouldParse: true, kind: "smart_search" },

  // --- kal / yesterday ---
  { phrase: "Kal wali pdf kholo", shouldParse: true, kind: "smart_search" },
  { phrase: "Aaj ki file dikhao", shouldParse: false },
  { phrase: "Parso wali file", shouldParse: false },

  // --- apps hinglish ---
  { phrase: "Calculator kholo", shouldParse: true, kind: "launch_app" },
  { phrase: "Notepad khol do", shouldParse: true, kind: "launch_app" },
  { phrase: "VS Code chalu kar do", shouldParse: true, kind: "launch_app" },
  { phrase: "Chrome band karo", shouldParse: true, kind: "close_app" },
  { phrase: "Spotify switch karo", shouldParse: false },

  // --- compound aur / and ---
  { phrase: "Downloads kholo aur mera resume kholo", shouldParse: true, kind: "compound" },
  { phrase: "Open downloads and open my resume", shouldParse: true, kind: "compound" },
  { phrase: "Download kholo phir resume kholo", shouldParse: true, kind: "compound" },

  // --- Hindi devanagari ---
  { phrase: "डाउनलोड खोलो", shouldParse: true, kind: "folder" },
  { phrase: "मेरा रिज्यूमे खोलो", shouldParse: true, kind: "smart_search" },
  { phrase: "कैलकुलेटर खोलो", shouldParse: true, kind: "launch_app" },
  { phrase: "फिर से खोलो", shouldParse: true, kind: "recall_memory" },

  // --- Urdu script ---
  { phrase: "ڈاؤنلوڈ کھولو", shouldParse: true, kind: "folder" },
  { phrase: "میرا ریزیوم کھولو", shouldParse: true, kind: "smart_search" },

  // --- recall / dubara ---
  { phrase: "Dubara kholo", shouldParse: true, kind: "recall_memory" },
  { phrase: "Phir se open karo", shouldParse: true, kind: "recall_memory" },
  { phrase: "Woh project kholo", shouldParse: true, kind: "recall_memory" },
  { phrase: "Open that project", shouldParse: true, kind: "recall_memory" },

  // --- file ops ---
  { phrase: "Create folder called TestRipple", shouldParse: true, kind: "create_folder" },
  { phrase: "Delete temp.txt", shouldParse: true, kind: "delete_file" },
  { phrase: "Rename old.txt to new.txt", shouldParse: true, kind: "rename_file" },
  { phrase: "Downloads mein folder banao naam user", shouldParse: true, kind: "create_folder" },
  { phrase: "Downloads mein file banao naam notes.txt", shouldParse: true, kind: "create_file" },
  { phrase: "Delete temp.txt kar do", shouldParse: true, kind: "delete_file" },
  { phrase: "डाउनलोड में फोल्डर बनाओ, नाम test", shouldParse: true, kind: "create_folder" },

  // --- system ---
  { phrase: "Lock my PC", shouldParse: true, kind: "system_action" },
  { phrase: "Bluetooth settings kholo", shouldParse: true, kind: "system_action" },

  // --- should NOT be desktop ---
  { phrase: "Tell me a joke", shouldParse: false },
  { phrase: "What's the weather", shouldParse: false },
  { phrase: "Open gmail", shouldParse: true, kind: "open_workspace" },
  { phrase: "Write email to boss", shouldParse: false },
  { phrase: "Hello", shouldParse: false },
  { phrase: "Thanks", shouldParse: false },

  // --- whisper-style glued (post-normalize) ---
  { phrase: "Open download", shouldParse: true, kind: "folder" },
  { phrase: "Upon documents", shouldParse: true, kind: "folder" },
];

describe("Phase 4.7 — slang / phone / Hinglish matrix", () => {
  it.each(SLANG_MATRIX.map((c) => [c.phrase, c] as const))(
    '%s',
    (phrase, spec) => {
      const { nlu } = preprocessForNlu(phrase);
      expect(nlu.length).toBeGreaterThan(0);

      const result = parseDesktopIntent(phrase);
      if (spec.shouldParse) {
        expect(result).not.toBeNull();
        if (spec.kind) {
          expect(result?.intent.kind).toBe(spec.kind);
        }
      } else {
        expect(result).toBeNull();
      }
    },
  );
});

describe("Slang matrix — no merged token regressions", () => {
  it.each([
    "Download kholo",
    "Downloads karo",
    "Download kar do",
    "Documents kholo",
  ])('no downloadsopen in "%s"', (phrase) => {
    const { nlu } = preprocessForNlu(phrase);
    expect(nlu.toLowerCase()).not.toMatch(/downloadsopen|downloadskaro|documentsopen/);
  });
});
