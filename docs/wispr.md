# Task: Upgrade voice dictation correction system (P7.2) to production quality

Goal: replace regex-as-decision-maker with a layered pipeline (heuristic
signal detector → LLM intent classifier → LLM rewrite generator, only when
needed → safe rewrite engine), matching Wispr Flow–style correction
intelligence. Reuse existing files where noted — do not rewrite from scratch.

## Implementation status (2026-07-18)

Phase 1 is implemented:
- Layer 1 signal detector: `correctionSignalDetector.ts`
- Structured Layer 2A/2B backend APIs:
  `/voice/dictation/analyze` and `/voice/dictation/generate`
- Layer 3 confidence/length gates: `safeRewriteEngine.ts`
- Async orchestrator + structured decision log: `dictationRewrite.ts`
- Fixed 14-case eval: `phase-p85-p72-production-eval.spec.ts`

Two corrections were required while implementing this document:
1. A `revision_cue` signal was added for ambiguous `wait` / `sorry make that`
   phrases. It never auto-applies; it only routes to Layer 2A.
2. Layer 3 receives marker boundaries from Layer 1. Without those boundaries,
   replacing `Monday` with `Tuesday` in `Monday no Tuesday` would incorrectly
   produce `Tuesday no Tuesday`.

Existing files to reuse/extend (do not discard):
- `electron/agent/dictation/correctionEngine.ts` — becomes Layer 1 (signal
  detector only, no longer applies text changes on its own).
- `electron/agent/dictation/dictationRewrite.ts` — becomes the orchestrator
  that calls Layer 1 → Layer 2A → (Layer 2B if needed) → Layer 3 in sequence.
- `electron/storage/voiceCorrections.ts` — P6 spoken→canonical corrections,
  unchanged, still applied after Layer 3.

---

## Architecture

```
RAW VOICE TEXT (bufferText + new utterance)
        |
        v
Layer 1: Fast Local Signal Detector (regex, deterministic, 0ms, offline)
        |
        ├─ high-confidence safe pattern → produce a correction CANDIDATE, send to Layer 3 (skip 2A/2B)
        ├─ ambiguous pattern → flag, send to Layer 2A
        └─ no signal → pass through unchanged, skip Layer 2A entirely
        |
        v
Layer 2A: Correction Intent Analyzer (LLM, classification only, structured JSON)
        |
        ├─ type is replace/delete/append/none → skip 2B, go straight to Layer 3
        └─ type is tone_change/rewrite → Layer 2B
        |
        v
Layer 2B: Rewrite Generator (LLM, generation only, called only for tone/rewrite)
        |
        v
Layer 3: Safe Rewrite Engine (confidence gates, mechanical apply or reject)
        |
        v
FINAL TEXT + structured log entry
```

**Non-negotiable principle:** if the pipeline is ever unsure, it keeps the
user's original words. Never silently drop or shorten user speech without a
logged, explicit reason.

---

## Layer 1 — Local Signal Detector

Regex is a **signal detector**, not a decision maker, and **Layer 1 never
mutates text itself under any circumstance.** Its only output is a candidate
decision object — the same shape Layer 2A would produce — which is then
routed to Layer 3. Layer 3 is the single, sole place in the pipeline where
text is actually mutated. This matters for debuggability: if two different
layers can both write to the buffer, a "Layer 1 already changed this, then
Layer 3 rejected the candidate" scenario becomes very hard to trace in
production logs. One mutation point, always.

### Signal taxonomy (extend the existing `CorrectionKind`, do not just add flags)

```ts
type SignalKind =
  | "double_no"          // "no no", "wait wait" — always safe
  | "scratch_that"       // "scratch that" — always safe, but scope must be resolved (see below)
  | "delete_directive"   // "delete the last sentence", "remove that", "undo"
  | "actually_no"        // "actually no", "no actually" — safe combo
  | "bare_actually"       // lone "actually" with no "no" nearby — ambiguous, usually filler
  | "single_no"          // lone "no" — ambiguous, usually NOT a correction
  | "revision_cue"       // "wait", "sorry make that" — ambiguous; Layer 2A only
  | "tone_directive"     // "make it professional", "make it casual" — always needs Layer 2/3 generation
  | "none";              // no signal at all
```

### Rules

- `double_no`, `actually_no` → produce a correction **candidate** (never
  applied by Layer 1 itself) **only if a plausible replacement candidate
  exists** in the tail (e.g. "Monday no no Tuesday" — clear replacement
  target) **and** the marker appears near the end of the utterance (i.e.
  there is a clear preceding clause to revise, not just an incidental
  adjacency of words). If the pattern matches structurally but either
  condition fails — no replacement candidate, e.g. "I don't know no no one
  told me" ("no no" is embedded inside "no one"); or no clear preceding
  clause, e.g. "I actually no longer work there" (contains the literal
  adjacent tokens "actually" + "no" but is not a self-correction at all) —
  do NOT produce an auto-apply candidate. Route to Layer 2A instead with
  `confidence: 0.90` and `requiresLLM: true`. Only when both conditions are
  clearly met does this produce a Layer-3-bound candidate with
  `requiresLLM: false, confidence: 0.95+`. A "plausible replacement
  candidate" = the tail contains content that could stand in for something
  in the head (a date, name, time, or clause) — reuse the existing
  `sharedPhraseStartIndex`/date-and-weekday checks *only* as this candidate
  check, never as the sole gate for auto-apply (see `single_no` rule below for
  why unrestricted use of that heuristic is unsafe).
  - Safe example: `"Meeting Monday, actually no Tuesday"` — clause + replacement candidate both present → candidate produced.
  - Unsafe example: `"I actually no longer use this app"` → no preceding clause to revise, "no longer" is not a replacement target → route to Layer 2A.
- `single_no` → **always** `requiresLLM: true`, regardless of surrounding
  words, with one narrow exception: a small, closed whitelist of common
  idiomatic openers — "no problem", "no worries", "no chance", "no idea", "no
  thanks" — matched only at the start of the utterance, skip Layer 2A entirely
  and treat as `none`. This whitelist exists purely as a cost optimization and
  must stay small and rarely-edited; it is not a general safety mechanism and
  must never grow into a substitute for Layer 2A classification. Outside this
  whitelist, do not try to guess via word-overlap heuristics
  (`tailRevisesHead`/`sharedPhraseStartIndex` in the current code) — that
  guessing is exactly what breaks "I have money, no debt at all." Delete that
  guessing logic from any path that could produce an auto-apply candidate; it
  may still run as a *feature* fed into the Layer 2A prompt as a hint, but
  must never gate a candidate on its own.
- `bare_actually` → `requiresLLM: true`. Because "actually" is common filler
  in ordinary speech, do NOT log this as a full classifier call if it appears
  mid-sentence with no clause boundary near it (e.g. "it's actually pretty
  good") — use a cheap pre-check: only route to Layer 2A if "actually" appears
  within the last ~6 words of the buffer AND is followed by content that could
  plausibly replace something already said. Otherwise treat as `none` (pure
  filler, pass through). This is a cost optimization, log it as
  `signal: "bare_actually_filtered"` either way for observability.
- `scratch_that` → safe signal, candidate still routes through Layer 3, but
  **scope is not defined by the phrase alone**. "Scratch that" could mean
  "scratch the last sentence" or "scratch the last word." Default scope =
  last completed clause (up to the last sentence-ending punctuation or last
  ~15 words, whichever is shorter). This must be explicit and configurable,
  not silently assumed.
- `delete_directive` → maps to `type: "delete"`. Confidence high only if a
  target is named or clearly refers to "last sentence"/"last part"; otherwise
  route to Layer 2A to resolve target boundaries.
- `tone_directive` → **always** `requiresLLM: true`, and always routes through
  Layer 2A then Layer 2B (see below) — never a mechanical string replace,
  because there is no `original`/`replacement` pair for a tone change.

### Layer 1 output contract

```json
{
  "detected": true,
  "signal": "double_no",
  "confidence": 0.95,
  "requiresLLM": false,
  "candidate": {
    "type": "replace",
    "original": "tomorrow",
    "replacement": "today"
  }
}
```
`candidate` is present only when `requiresLLM: false`. It is **not applied by
Layer 1** — it is handed to Layer 3, which runs the same confidence-gate and
apply logic on it as it does on Layer 2A output. Log this object every time a
candidate is produced, even when Layer 3 later rejects it — do not apply
invisibly, and do not let Layer 1 and Layer 3 both claim to have mutated the
buffer.

---

## Layer 2A — Correction Intent Analyzer (LLM, classification only)

Classification only. Never asked to write prose. Mixing classification and
generation into one call hides whether a failure was a misclassification or a
bad rewrite — keep them as two separate calls with two separate jobs.

### System prompt (use verbatim, adapt model name)

```
You are a correction-intent classifier for a voice dictation system.
You do not rewrite text creatively. You detect whether the user is
self-correcting something they just said, and if so, precisely what
changed. You never produce rewritten prose yourself — if a rewrite is
needed, you only describe what change is wanted.

You will receive:
- committedBuffer: text already confirmed/typed and inserted into the field (may be empty)
- currentUtterance: the latest raw utterance, not yet applied
- lastSentence: the most recent completed sentence within committedBuffer, if any (helps resolve "the last sentence"/"that" style scope)
- cursorPosition: optional, only present if the target surface supports arbitrary-position editing (most dictation surfaces append at the end, so this is usually null)
- signal_hint: a heuristic guess from a regex layer (may be wrong — verify, do not trust blindly)

Note: committedBuffer and currentUtterance are deliberately separate fields.
Corrections can target the just-spoken utterance, the previously committed
sentence, or the entire buffer — treating them as one merged string loses the
information needed to resolve which scope the user means.

Return ONLY valid JSON, no prose, no markdown fences, matching exactly:

{
  "isCorrection": boolean,
  "type": "replace" | "delete" | "append" | "tone_change" | "rewrite" | "none",
  "scope": "word" | "phrase" | "sentence" | "full_buffer",
  "confidence": number,       // 0.0-1.0
  "original": string | null,  // exact substring being replaced/deleted, null if not applicable
  "replacement": string | null, // new substring for replace/append, null if not applicable
  "rewriteInstruction": string | null, // ONLY for tone_change/rewrite: a short plain-language instruction for a separate generator model (e.g. "make this more professional"). NEVER the rewritten text itself.
  "correctionReason": "date_change" | "time_change" | "name_change" | "location_change" | "number_change" | "word_replacement" | "tone_adjustment" | "grammar_fix" | "delete_content" | "unknown" | null,
  "reason": string            // one short clause explaining the decision
}

Rules:
- If type is "replace" or "delete", you MUST populate "original" with the
  exact text being changed. Never leave it null for these types.
- If type is "tone_change" or "rewrite", populate "rewriteInstruction" with a
  short instruction describing the requested change. Do NOT write the
  rewritten sentence yourself — a separate model handles generation.
- "correctionReason" is an optional enrichment field for logging/analytics —
  populate it when the type of change is clear (e.g. a date, time, or name
  swap); use "unknown" rather than guessing if it's unclear. It does not
  affect apply/reject behavior in Layer 3.
- If the input is not a correction at all (e.g. "no" is part of normal
  meaning, like "I have money, no debt"), return isCorrection: false,
  type: "none", confidence close to 1.0, and explain why in "reason".
- Never guess silently. If you are not confident, lower the confidence score
  rather than fabricating a decision.
- Do not drop any part of the user's speech unless it is explicitly what the
  correction is removing. If you shorten the output for any other reason,
  you must list the exact dropped substrings under "reason".
```

### Few-shot examples for Layer 2A

```
Input:
committedBuffer: "Schedule meeting Monday afternoon"
currentUtterance: "Schedule the meeting for Monday no Tuesday afternoon"
signal_hint: single_no
Output:
{"isCorrection":true,"type":"replace","scope":"word","confidence":0.96,"original":"Monday","replacement":"Tuesday","rewriteInstruction":null,"correctionReason":"date_change","reason":"user replaced the day"}

Input:
committedBuffer: ""
currentUtterance: "I have money, no debt at all"
signal_hint: single_no
Output:
{"isCorrection":false,"type":"none","scope":"word","confidence":0.98,"original":null,"replacement":null,"rewriteInstruction":null,"correctionReason":null,"reason":"'no' is part of the sentence meaning, not a self-correction"}

Input:
committedBuffer: "Send the client update tomorrow."
currentUtterance: "actually make it sound less formal because they are already familiar with the project"
signal_hint: bare_actually
Output:
{"isCorrection":true,"type":"tone_change","scope":"sentence","confidence":0.9,"original":null,"replacement":null,"rewriteInstruction":"make the tone more casual/informal, since the recipient already knows the project","reason":"user requested a tone adjustment, not a factual correction"}

Input:
committedBuffer: "No problem, I can wait"
currentUtterance: "No problem, I can wait"
signal_hint: single_no
Output:
{"isCorrection":false,"type":"none","scope":"word","confidence":0.99,"original":null,"replacement":null,"rewriteInstruction":null,"correctionReason":null,"reason":"greeting/acknowledgment phrase, not a correction"}

Input:
committedBuffer: "I don't know something happened"
currentUtterance: "I don't know no no one told me"
signal_hint: double_no
Output:
{"isCorrection":false,"type":"none","scope":"word","confidence":0.9,"original":null,"replacement":null,"rewriteInstruction":null,"correctionReason":null,"reason":"'no no' here is part of 'no one', not a self-correction marker"}
```

## Layer 2B — Rewrite Generator (LLM, generation only)

Invoked only when Layer 2A returns `type: "tone_change"` or `type: "rewrite"`.
Does not decide whether a correction occurred — that decision was already
made by 2A. Only produces the rewritten text.

### System prompt

```
You rewrite a single piece of text according to one instruction. You do not
decide whether a correction is needed — that has already been decided. You
do not add new factual content, dates, names, or details that were not
present or implied in the original text. Preserve all factual content
unless the instruction explicitly says to remove something.

You will receive:
- original_text: the text to rewrite
- instruction: a short plain-language instruction

Return ONLY valid JSON, no prose, no markdown fences:

{
  "generatedText": string,
  "droppedContent": string[]   // any substrings from original_text that are absent from generatedText; empty array if none
}

If you cannot comply without dropping factual content, you must list exactly
what was dropped in "droppedContent" — never drop content silently.
```

### Few-shot example

```
Input:
original_text: "Send the client update tomorrow."
instruction: "make the tone more casual/informal, since the recipient already knows the project"
Output:
{"generatedText":"I'll send over the client update tomorrow.","droppedContent":[]}
```

---

## Layer 3 — Safe Rewrite Engine

Purely mechanical gate + apply. Never generates text itself.

### Rules

1. **Per-type confidence thresholds** (not one flat number), evaluated on
   Layer 2A's `confidence`:
   - `replace`: apply if `confidence >= 0.75`
   - `append`: apply if `confidence >= 0.70`
   - `delete`: apply if `confidence >= 0.85` (irreversible, higher bar)
   - `tone_change` / `rewrite`: apply if `confidence >= 0.80` (2A's
     confidence gates whether 2B is even called; Layer 3 does not
     independently re-score 2B's output)
   - Below threshold for any type → **do nothing**, keep original buffer text
     unchanged, log `applied: false, reason: "below_confidence_threshold"`,
     and skip calling Layer 2B entirely (no point generating a rewrite that
     won't be applied).

2. **Mechanical apply only for `replace`/`delete`/`append`:**
   - `replace`: string-replace exact `original` → `replacement` in the buffer.
     If `original` is not found verbatim in the buffer, reject and log
     `reason: "original_not_found_in_buffer"` — do not fuzzy-match.
   - `delete`: remove exact `original` substring, or if `scope: "sentence"`
     and no exact target, remove the last sentence bounded by punctuation.
   - `append`: concatenate `replacement` to the buffer.

3. **Generative apply only for `tone_change`/`rewrite`:**
   - Use `generatedText` from Layer 2B directly as the new buffer.
   - If Layer 2B's `droppedContent` is non-empty, still subject to the
     length-drop guard below to decide whether the drop is acceptable.

4. **Length-drop guard (mandatory, applies to every type) — token-based, not
   character-based:**
   - Tokenize input and output by whitespace-split word count (not character
     count — character counts are noisy across rewrites, e.g. "I'll" vs
     "I will"). If output token count is more than ~40% lower than input
     token count, reject unless Layer 2A's `reason` or Layer 2B's
     `droppedContent` explicitly names the dropped content. If no
     explanation is present, log `reason: "unexplained_length_drop"` and
     fall back to the pre-Layer-2 text (Layer 1 output / original buffer).
   - Example: input "I will join tomorrow because I have some work to
     finish" = 12 tokens; output "I will join tomorrow" = 5 tokens → 58%
     drop, well over the 40% bound → reject unless explained.

5. **Fallback when Layer 2A/2B (LLM) is unreachable/times out:**
   - Treat as `isCorrection: false` — keep the literal, unmodified buffer text
     from Layer 1. Log `modelUsed: "none_fallback", reason: "llm_unavailable"`.
   - This must be a real code path with a test, not an assumption.

---

## Required structured log (every single decision, no exceptions)

```json
{
  "input": "raw buffer + utterance",
  "layer1Signal": "single_no",
  "layer1AutoApplied": false,
  "layer2aCalled": true,
  "layer2aDecision": {
    "isCorrection": true,
    "type": "replace",
    "scope": "word",
    "confidence": 0.96,
    "original": "Monday",
    "replacement": "Tuesday",
    "rewriteInstruction": null,
    "reason": "user replaced the day"
  },
  "layer2bCalled": false,
  "layer2bDecision": null,
  "applied": true,
  "dropped": [],
  "finalText": "Schedule the meeting for Tuesday afternoon",
  "latencyMs": 340,
  "modelUsed": "dictation-classifier-v1"
}
```
For a `tone_change`/`rewrite` case, `layer2bCalled: true` and
`layer2bDecision` holds `{ generatedText, droppedContent }` from Layer 2B.
Log this at `info` level always (not just on failure) so silent-drop bugs like
the earlier `in=46 out=20` incident are diagnosable from logs alone, without
re-deriving them from character counts.

---

## Test cases (fixed — must have concrete previous_text + expected finalText)

```ts
// TEST 1 — safe double-no auto-apply, no LLM call (clear replacement candidate present)
input: { previous_text: "", new_voice_input: "I will come today no no day after tomorrow" }
expect: { finalText: "I will come the day after tomorrow", layer2aCalled: false }

// TEST 2 — single "no" that is NOT a correction (destructive false-positive guard)
input: { previous_text: "", new_voice_input: "I have money, no debt at all" }
expect: { finalText: "I have money, no debt at all", isCorrection: false }

// TEST 3 — single "no" that IS a correction
input: { previous_text: "Meeting is Monday", new_voice_input: "Meeting is Monday no Tuesday" }
expect: { finalText: "Meeting is Tuesday" }

// TEST 4 — replace a name, not a date
input: { previous_text: "Send email to John", new_voice_input: "Send email to John no send it to Michael" }
expect: { finalText: "Send email to Michael" }

// TEST 5 — tone_change with concrete buffer, routed through 2A then 2B
input: { previous_text: "Send the client update tomorrow.", new_voice_input: "Actually make it professional" }
expect: { layer2aDecision: { type: "tone_change" }, layer2bCalled: true, finalText: matches a professionally-toned rewrite of "Send the client update tomorrow." }

// TEST 6 — delete directive with concrete buffer
input: { previous_text: "I will join at 6pm. Also bring the report.", new_voice_input: "delete the last sentence" }
expect: { finalText: "I will join at 6pm." }

// TEST 7 — greeting/idiom "no" must never trigger
input: { previous_text: "", new_voice_input: "No problem, I can wait" }
expect: { finalText: "No problem, I can wait", isCorrection: false }

// TEST 8 — bare filler "actually", not near a correction, must not trigger classifier call
input: { previous_text: "", new_voice_input: "it's actually pretty good so far" }
expect: { layer2aCalled: false, finalText: "it's actually pretty good so far" }

// TEST 9 — LLM unavailable fallback
input: { previous_text: "", new_voice_input: "Meeting is Monday no Tuesday", forceLLMFailure: true }
expect: { finalText: "Meeting is Monday no Tuesday", modelUsed: "none_fallback" }

// TEST 10 — length-drop guard rejects an unexplained truncation (token-based)
input: { previous_text: "", new_voice_input: "I will join at 6pm because I have some work to finish first", mockLayer2aResponse: { isCorrection: true, type: "rewrite", rewriteInstruction: "shorten", reason: "" /* no drop explanation */ }, mockLayer2bResponse: { generatedText: "I will join at 6pm.", droppedContent: [] } }
expect: { applied: false, reason: "unexplained_length_drop", finalText: preserves original or Layer1 output }

// TEST 11 — "wait" as correction marker
input: { previous_text: "", new_voice_input: "I will send the report tomorrow wait Friday" }
expect: { finalText: "I will send the report Friday" }

// TEST 12 — "sorry make that" as correction marker
input: { previous_text: "", new_voice_input: "Meeting at 5 PM sorry make that 6 PM" }
expect: { finalText: "Meeting at 6 PM" }

// TEST 13 — "actually" replacing a filename, not a date/name/tone case
input: { previous_text: "", new_voice_input: "Open the file called invoice_final actually invoice_v2" }
expect: { finalText: "Open the file called invoice_v2" }

// TEST 14 — double_no false positive guard: "no no" embedded in "no one", must not auto-apply
input: { previous_text: "I don't know something happened", new_voice_input: "I don't know no no one told me" }
expect: { isCorrection: false, finalText: "I don't know no no one told me", layer1AutoApplied: false }
```

---

## Implementation requirements

1. Do not add more regex patterns to the auto-apply path. `revision_cue` is
   signal-only and must always route to Layer 2A.
2. Remove the existing word-overlap guessing (`tailRevisesHead`,
   `sharedPhraseStartIndex`) from any code path that can auto-apply without
   Layer 2. It may remain as a hint feature passed into the Layer 2 prompt.
3. Fix the existing `delete_phrase` bug where `base.replace(new RegExp(...), "gi")`
   deletes every occurrence of the phrase in the buffer, not just the intended
   one — scope deletes to the specific match location, not a global replace.
4. Every correction decision produces the structured log shown above, success
   or failure, applied or not.
5. Build the eval test suite (14 cases above, expand over time) and run it in
   CI on every change to `correctionEngine.ts` / `dictationRewrite.ts`.
6. Keep `applyCorrectionsToUtterance` (P6 memory corrections) running after
   Layer 3, unchanged — corrections like "nor" → "Noor" are orthogonal to this
   pipeline.
7. Fail-safe default: any uncertainty, timeout, error, or missing field →
   preserve the user's original words. Never silently shorten or remove
   speech.
8. Keep Layer 2A (classification) and Layer 2B (generation) as two separate
   model calls, not one combined call — do not merge them for latency
   reasons; call 2B only when 2A actually returns `tone_change`/`rewrite`.
9. The "no problem / no worries / no chance / no idea / no thanks" whitelist
   in Layer 1 is a bounded cost optimization only. Do not extend it beyond a
   handful of fixed idioms, and do not use the same pattern to skip Layer 2A
   for anything else — that would be reintroducing regex-as-decision-maker.

Ship bar for this task: all 14 tests green, structured log present on every
decision (including which of 2A/2B were called), zero regex-only auto-apply
for anything other than `double_no`/`actually_no` with a clear replacement
candidate, or unambiguous `delete_directive`.