/**
 * Production eval corpus — alternative-intent collapse (Phase 7.1).
 *
 * Offline / always-on gate: detection + soft plausibility + bounds.
 * Covers English, Hinglish, and light multilingual TOD/time mess patterns.
 * Does not call the live LLM (mocked in orchestrator tests elsewhere).
 */

import { describe, expect, it } from "vitest";
import {
  cleanupWithinBounds,
} from "../dictation/dictationRewrite.js";
import {
  altCollapseIsPlausible,
  detectIntentAlternatives,
  type IntentAlternativeKind,
} from "../dictation/intentAlternatives.js";

type CorpusCase = {
  id: string;
  lang: "en" | "hi-en" | "es" | "mixed";
  input: string;
  /** Expected detector kind (null = no alt path). */
  expectKind: IntentAlternativeKind;
  /**
   * Candidate AI cleanup. When accept=true must pass bounds+plausible;
   * when accept=false must fail at least one guard (still jammed / name drop).
   */
  aiOut: string;
  accept: boolean;
};

const CORPUS: CorpusCase[] = [
  // --- English TOD ---
  {
    id: "en-tod-morning-afternoon",
    lang: "en",
    input: "Hello Sir, Good Morning. Good Afternoon. How are you?",
    expectKind: "greeting_tod",
    aiOut: "Hello Sir, good afternoon. How are you?",
    accept: true,
  },
  {
    id: "en-tod-still-jammed",
    lang: "en",
    input: "Hello Sir, Good Morning. Good Afternoon. How are you?",
    expectKind: "greeting_tod",
    aiOut: "Hello Sir, good morning, good afternoon. How are you?",
    accept: false,
  },
  {
    id: "en-tod-name-drop-blocked",
    lang: "en",
    input: "Hello Tathir, Good Morning. Good Evening. How are you?",
    expectKind: "greeting_tod",
    aiOut: "Good evening. How are you?",
    accept: false,
  },
  {
    id: "en-tod-three-collapse",
    lang: "en",
    input: "Hey, good morning good afternoon good evening, free later?",
    expectKind: "greeting_tod",
    aiOut: "Hey, good evening — free later?",
    accept: true,
  },

  // --- English times ---
  {
    id: "en-time-9-10-collapse",
    lang: "en",
    input: "Text me at 9 o'clock, text me at 10 pm please",
    expectKind: "clock_times",
    aiOut: "Text me at 10 pm please.",
    accept: true,
  },
  {
    id: "en-time-range-merge",
    lang: "en",
    input: "Can we meet this evening today at 9, 10 pm",
    expectKind: "clock_times",
    aiOut: "Can we meet this evening around 9–10 pm?",
    accept: true,
  },
  {
    id: "en-time-still-jammed",
    lang: "en",
    input: "Meet at 9 o'clock meet at 10 o'clock",
    expectKind: "clock_times",
    aiOut: "Meet at 9 o'clock meet at 10 o'clock.",
    accept: false,
  },

  // --- English repeated offers ---
  {
    id: "en-offer-coffee-tea",
    lang: "en",
    input:
      "Can we meet for a coffee, can we for a tea like this evening today at 9, 10 pm",
    expectKind: "clock_times", // times fire first when both present
    aiOut: "Can we meet for coffee or tea this evening around 9–10 pm?",
    accept: true,
  },
  {
    id: "en-offer-can-we-x2",
    lang: "en",
    input: "Can we sync tomorrow, can we sync on Friday instead",
    expectKind: "repeated_offer",
    aiOut: "Can we sync on Friday instead?",
    accept: true,
  },

  // --- Safe non-alt (must NOT trigger detector) ---
  {
    id: "en-clean-greeting-no-alt",
    lang: "en",
    input: "Hello Tathir, how are you? Can we meet at 10 o'clock",
    expectKind: null,
    aiOut: "Hello Tathir, how are you? Can we meet at 10 o'clock?",
    accept: true,
  },
  {
    id: "en-single-tod",
    lang: "en",
    input: "Good morning, hope you're well",
    expectKind: null,
    aiOut: "Good morning, hope you're well.",
    accept: true,
  },

  // --- Hinglish ---
  {
    id: "hi-en-tod",
    lang: "hi-en",
    input: "Hello bhai good morning good afternoon, free ho kya?",
    expectKind: "greeting_tod",
    aiOut: "Hello bhai, good afternoon — free ho kya?",
    accept: true,
  },
  {
    id: "hi-en-time",
    lang: "hi-en",
    input: "Kal milte hain at 5 pm ya at 6 pm bata dena",
    expectKind: "clock_times",
    aiOut: "Kal milte hain at 6 pm, bata dena.",
    accept: true,
  },
  {
    id: "hi-en-offer",
    lang: "hi-en",
    input: "Can we baat karte hain, can we call pe discuss karte hain",
    expectKind: "repeated_offer",
    // Keep enough of the original so soft bounds stay loose (not last-only strict).
    aiOut: "Can we call pe discuss karte hain?",
    accept: true,
  },

  // --- Spanish (light) ---
  {
    id: "es-tod-en-mix",
    lang: "es",
    input: "Hola, good morning good evening, ¿cómo estás?",
    expectKind: "greeting_tod",
    aiOut: "Hola, good evening, ¿cómo estás?",
    accept: true,
  },
  {
    id: "es-time",
    lang: "es",
    input: "Nos vemos at 7 pm o at 8 pm?",
    expectKind: "clock_times",
    aiOut: "Nos vemos at 8 pm?",
    accept: true,
  },

  // --- Mixed mess ---
  {
    id: "mixed-long-mush",
    lang: "mixed",
    input:
      "Um hello Sir good morning good afternoon how are you can we meet for coffee can we for tea at 9 at 10",
    expectKind: "greeting_tod",
    aiOut:
      "Hello Sir, good afternoon. How are you? Can we meet for coffee or tea around 9–10?",
    accept: true,
  },
  {
    id: "mixed-mush-still-jammed",
    lang: "mixed",
    input:
      "Hello Sir good morning good afternoon how are you",
    expectKind: "greeting_tod",
    aiOut: "Hello Sir good morning good afternoon how are you",
    accept: false,
  },
];

function passesProductionGuards(
  input: string,
  aiOut: string,
  allowAlt: boolean,
  kind: IntentAlternativeKind,
): boolean {
  if (!cleanupWithinBounds(input, aiOut, { allowAlternativeCollapse: allowAlt })) {
    return false;
  }
  if (allowAlt && !altCollapseIsPlausible(input, aiOut, kind)) {
    return false;
  }
  return true;
}

describe("P7.1 alt-intent production eval corpus", () => {
  for (const c of CORPUS) {
    it(`${c.id} [${c.lang}] detect=${c.expectKind ?? "none"} accept=${c.accept}`, () => {
      const hit = detectIntentAlternatives(c.input);
      expect(hit.kind).toBe(c.expectKind);

      const allowAlt = hit.detected;
      const ok = passesProductionGuards(
        c.input,
        c.aiOut,
        allowAlt,
        hit.kind,
      );

      // Same-text AI "cleanup" is a no-op at orchestrator — treat as reject path.
      const changed = c.aiOut.trim() !== c.input.trim();
      if (!changed) {
        expect(c.accept).toBe(false);
        return;
      }

      expect(ok).toBe(c.accept);
    });
  }

  it("soft guard allows range merge without requiring last-only", () => {
    expect(
      altCollapseIsPlausible(
        "meet at 9 pm meet at 10 pm",
        "meet around 9–10 pm",
        "clock_times",
      ),
    ).toBe(true);
  });

  it("soft guard rejects still-jammed TOD without being last-only strict", () => {
    expect(
      altCollapseIsPlausible(
        "good morning good afternoon",
        "good morning and good afternoon",
        "greeting_tod",
      ),
    ).toBe(false);
    expect(
      altCollapseIsPlausible(
        "good morning good afternoon",
        "good morning",
        "greeting_tod",
      ),
    ).toBe(true);
  });
});
