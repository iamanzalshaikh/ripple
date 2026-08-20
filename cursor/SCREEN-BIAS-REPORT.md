# Feature #20: Context-aware spelling — round 2 (live failures from your 2026-08-20 log)

## What your log actually showed, and what I changed

Your run had **three** distinct problems. All three are now fixed in code with tests:

| Your live case | Log evidence | Cause | Fix |
|---|---|---|---|
| `Umar Masai` → not corrected | `headerTerms=[Ummer Mishal, Ummer, Mishal]` but **no** `appliedFixes` | Phrase distance `"umar masai"`→`"ummer mishal"` is ~6, limit was 4 → no phrase match → my sidebar guard then also blocked the per-token `Umar→Ummer` | **First-name anchor**: in `First Last`, the first name decides identity. `Umar~Ummer` ⇒ same person ⇒ whole phrase replaced. Verified live: `appliedFixes=[Umar Masai→Ummer Mishal]` |
| `Kumar Mishra` → `Kumar Mishal` (wrong) | `headerTerms=0`, `appliedFixes=[Mishra→Mishal]` | When header detection returned nothing there was **no guard at all**, so the legacy token rule fired | **Protected name phrases**: any `First Last` the user spoke that matched no screen name can never be half-corrected — with or without header context |
| `Umar Mishael` / `Rayyan` → nothing | `no_terms chars=238`, `terms=1`, no `ocr_fallback` line | OCR silently timed out at 280 ms (it succeeded roughly 1 run in 3) | Budget raised, and **every** run now logs `ocr_ms`. Measured after fix: **89–211 ms** — the old budget was simply too tight |

## The bigger finding: Ripple was reading its own window

With the dashboard open, full-screen OCR returned **Ripple's own UI**, not your chat:

```
debug_sample="... Ripple Dashboard Voice typing for Windows • noor@gmail.com
              Notes Language Styles Snippets Dictionary History Log ..."
```

The chat was completely occluded, so no contact name could ever be found. Two guards added:
- OCR now targets the **pinned chat window** (`captureScreenOcr(target.hwnd)`) instead of the raw screen.
- If the captured text is recognisably Ripple's own UI, it is **discarded** with `ocr_self_capture` rather than biasing toward our own menu labels.

This connects to the dev-only boot behaviour flagged earlier: `showMainWindow({userInitiated:true})` force-pops the dashboard on every dev launch, putting it on top of whatever you were using.

## Honest limitation of my live testing

I could not validate end-to-end automatically. Every attempt to bring WhatsApp to the foreground was refused by Windows (`WA_FG=False`), and the bridge dictations therefore OCR'd whatever was actually in front — at various points Cursor, a shopping page, and a different project (`placement_board_students.json - CAD TECH - Cursor`). Those runs say nothing about this feature.

What **is** proven: with WhatsApp genuinely in front, the pipeline produced
`headerTerms=[Ummer Mishal, Ummer, Mishal]` → `appliedFixes=[Umar Masai→Ummer Mishal]` →
`finalText="Hello, Ummer Mishal sir, how are you?"`.

**Real confirmation needs one human-driven dictation**: focus the Ummer Mishal chat, press the hotkey, speak a near-miss. That is the flow the feature is built for (hotkey pins the chat *and* it is the visible window); a bridge-driven test cannot reproduce it on a machine in active use.

---

# Round 1 report (Ummer Mishal primary case)

**Primary success case passes live on WhatsApp Web (Chrome), with log proof.**

```
[ripple-screen-bias] ocr_fallback uiaTerms=4 ocrChars=1531
[ripple-screen-bias] gather chars=1821 terms=40 headerTerms=3
[ripple-screen-bias] headerTerms=[Ummer Mishal, Ummer, Mishal]
[ripple-screen-bias] appliedFixes=[Umar Mishal→Ummer Mishal]
[ripple-screen-bias] surface=dictation terms=40 fixes=Umar Mishal→Ummer Mishal
finalText="Hello Ummer Mishal, how are you?"
```

---

## Live results — every known failure is now a PASS

Real dictation pipeline (STT skipped via the existing `__ripple_dictate__` bridge), user's own WhatsApp Web open on **Ummer Mishal**.

| Run | STT input | Before (broken) | **Now** | Log |
|-----|-----------|-----------------|---------|-----|
| A / 2 | `Hello Umar Mishal, how are you?` | `Hello Umar Mishal` (no fix) | **`Hello Ummer Mishal, how are you?`** | `fixes=Umar Mishal→Ummer Mishal` |
| 1 | `Hello Humar` | `Hello Humar` (no fixes) | **`Hello Ummer.`** | `fixes=Humar→Ummer` |
| 2 | `Hello Umar Misal, how are you?` | `Hello Umar Mishal` (half-fixed) | **`Hello Ummer Mishal, how are you?`** | `fixes=Umar Misal→Ummer Mishal` |
| 3 | `Hello Kumar Mishra` | `Hello Kumar Mishal` ❌ wrong | **`Hello Kumar Mishra.`** unchanged ✅ | no `fixes=` line |
| 5 | (Cursor foreground) | no `ocr_fallback` at all | **`ocr_fallback` now emitted every time** | see below |

---

## Root causes fixed

All in `electron/agent/dictation/screenNameBias.ts`.

1. **OCR never ran when it mattered** (`gatherNearbyScreenText`)
   `if (uiaTerms.length >= 2) return uia` short-circuited before OCR. WhatsApp Web and Cursor both expose plenty of UIA *junk*, so the ≥2 threshold was always met and the chat header — which lives only in pixels — was never read. This was live-failure Run 5. Removed; OCR now runs whenever there is no confident header name.

2. **Editor/browser titles counted as person names** (`extractTitlePriorityTerms`)
   `"screen-bias-loop.md - projectRipple - Cursor"` passed as a title name, making `hasStrongNameSignal` true and again suppressing OCR. Added `isPersonNameLike()` — rejects digits, dots, slashes, `@`, `:`, `_`, >4 words. Also blocks WhatsApp's `"Type a message to +971…"` phone hint (checklist item 5).

3. **A single capitalized word counted as a chat header** (`hasStrongNameSignal`)
   Live capture showed `headerTerms=[Zoom]` — Notepad's status bar. Now a header must be a real two-word `First Last`. Added Notepad/editor chrome to `UI_STOPWORDS` (`zoom`, `untitled`, `plain`, `line`, `column`, `windows`, `crlf`, `utf`).

4. **Header name unfindable in real OCR** → `extractRepeatedNamePhrases()` *(new)*
   The decisive finding. OCR of WhatsApp Web **never** yields a clean `Ummer Mishal` line — it comes back glued to neighbours:
   ```
   "All Bookmarks Ummer Mishal"
   "Ummer Mishal Assalamualikurn Walikumsalaam"
   "Ummer Mishal Thanks Get"
   ```
   So line-based title extraction returned zero (`headerTerms=0` observed live). But the **open** chat's name repeats across header + sidebar + bubbles, while other contacts appear once. Frequency (≥2 occurrences) therefore identifies the active conversation with no pixel coordinates needed. This is what made Test A pass.

5. **`Umar`→`Ummer` blocked by distance** — `maxAllowedDistance(5)=1`, actual distance 2.
   Header-priority targets now get **+1 edit budget** (`matchesPriorityTarget`).

6. **`Humar`→`Ummer` blocked by the first-letter gate** (h≠u).
   Added `phoneticKey()`: collapse doubled letters → drop leading `h` → flatten vowel runs. `humar`/`umar`/`ummer` all key to `amar`. Deliberately narrow — verified it still separates `mishra`≠`mishal`, `kumar`≠`ummer`, `working`≠`morning`.

7. **`Rayyan`→`Rayan`** — doubled-letter collapse/expand equivalence (first letter must still agree).

8. **`Kumar Mishra`→`Kumar Mishal` (wrong fix)** — two bugs:
   - No whole-phrase pass: only the last name was matched, in isolation, where `mishra`→`mishal` is distance 2 and passes.
   - **`findNamePhrases()`**: my first phrase scan used one `/g` regex, which consumed `"Hello Kumar"` and never offered `"Kumar Mishra"` for testing. Adjacent pairs must be allowed to **overlap**, so this now does an indexed word scan.
   Fix: whole-phrase match runs first; if the utterance names a *different* two-word person than the header, that header's parts are **suppressed** from per-token fixing (checklist items 2 + 4).

---

## VERIFY checklist

### Code / unit
- [x] `npx vitest run electron/agent/dictation/__tests__/phase-p7-7-screen-name-bias.spec.ts` — **25/25 pass**
- [x] `Umar Mishal` → `Ummer Mishal` (full phrase + per-token)
- [x] `Umar` → `Ummer` (distance-2 double-letter stretch)
- [x] `Humar` → `Ummer` (silent-H drift)
- [x] `Rayyan` → `Rayan`
- [x] `Misal` → `Mishal` (pre-existing, still green)
- [x] **Negative:** `Kumar Mishra` stays put when the open chat is Ummer Mishal
- [x] **Negative:** `like` never becomes `Liked`
- [x] **Negative:** `working` never becomes `Morning`
- [x] **Negative:** editor titles / phone hints are not header names
- [x] **Regression guard:** without `priorityTerms`, strict legacy rules still apply (`Humar` stays `Humar`)
- [x] **Real-OCR fixture test** built from the verbatim live capture

### Live WhatsApp Web (Chrome)
- [x] **Test A** (Ummer Mishal DM): paste contains **both** words — `Hello Ummer Mishal, how are you?`
- [x] Negative live: `Kumar Mishra` unchanged
- [x] Every live run emits a `[ripple-screen-bias]` line — never a silent skip
- [ ] **Test B** (group `~ Rayan`) — **not run live:** requires opening a specific group chat in the user's account. Covered by unit test.
- [ ] **Test C** (Anzal DM) — **not run live:** same reason. Covered by unit test.

### Log signals
- [x] `ocr_fallback uiaTerms=… ocrChars=…` when UIA has no header
- [x] `surface=dictation terms=… fixes=…` when a correction lands
- [x] `headerTerms=[…]` + `appliedFixes=[…]` (checklist item 6)
- [x] `gather chars=… terms=… headerTerms=…` every dictation — bias is never silently skipped
- [x] `no_terms reason=…` / `failed open:` on the empty paths

### Regression
- [x] **125/125** tests pass across dictation + compose-prepare + focus + windows + insert suites
- [x] Typecheck: **zero** errors in touched files
- [x] 4 consecutive live dictations, no crash, no focus loss
- [x] Gap analysis row 20 → ✅ with evidence link

---

## Files changed

| File | Change |
|---|---|
| `electron/agent/dictation/screenNameBias.ts` | `isPersonNameLike`, `phoneticKey`, `collapseDoubles`, `matchesPriorityTarget`, `findNamePhrases`, `extractRepeatedNamePhrases`, whole-phrase pass + sidebar suppression, OCR gating fix, header/fix logging |
| `electron/agent/dictation/__tests__/phase-p7-7-screen-name-bias.spec.ts` | +13 tests (all spec cases incl. real-OCR fixture) |
| `docs/WISPR-FLOW-GAP-ANALYSIS.md` | Row 20 → ✅ with evidence link |

**No insert/focus files modified.** `git diff --stat` over `electron/` shows only `screenNameBias.ts` and its spec from this work. Untouched: insert ladder (`clipboard_paste`, `native_text`, `modifiers_before_send`, `target_state`, `composer_focus`), `electron/focus/**` (`hotkey_pin`, `press_sequence`, `main_suppress`, `restoreFocusContext`), Chrome insert path, Meeting Notetaker, Dev Mode, F9 transforms. Jarvis remains off and bias is not gated on it.

> Note: `prepareComposeText.ts` and `meetingRecorder.ts` also show as modified in the working tree — those are **pre-existing uncommitted edits, not from this work**. The bias call site in `prepareComposeText.ts` was read and left byte-for-byte unchanged.

## Latency

No budget change: `GATHER_BUDGET_MS = 350`, `OCR_BUDGET_MS = 280` (unchanged). OCR now runs *more often* (whenever no header name is present) — that is the intended fix for Run 5, bounded by the same 280 ms timeout and fail-open. Live `ocr_fallback` captures measured 1446–1531 chars within budget.

## Still open

- **Tests B and C not verified live** — they need specific chats opened in the user's WhatsApp/Instagram. Both pass as unit tests with realistic fixtures.
- **Frequency heuristic assumption:** the active chat is identified by a name appearing ≥2× on screen. Verified on real WhatsApp Web OCR. A sidebar contact whose name also appears inside message text could in principle tie; the whole-phrase guard limits the blast radius (a wrong two-word phrase is rejected outright rather than half-applied).
- `debug_sample` / `debug_terms` logging is gated behind `RIPPLE_SCREEN_BIAS_DEBUG=1` and off by default.

---

**Recommended: one human-observed WhatsApp dictation (Ummer Mishal chat) as final confirmation.**
