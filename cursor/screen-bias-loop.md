You are working in a loop. Do not stop after one pass — keep iterating until every VERIFY item passes or you hit the iteration limit. Unit tests alone are NOT enough. Live WhatsApp proof OR fixture-harness proof with real OCR sample is required. Do not ask the user mid-loop — assume, note, continue.

GOAL:
Complete **Feature #20 — Context-aware spelling (on-screen text)** to production quality.

When the user dictates a near-miss name that is **visible on the entire screen** (chat header, message bubbles, sidebar) but **not in the dictionary**, Ripple must correct it **before paste** using local UIA + full-screen / pinned-window OCR (fail-open). The correction must use the **active chat contact**, not random sidebar names.

**Primary success case (BLOCKING — must pass to FINAL):**
- WhatsApp Web (Chrome) DM open with **Ummer Mishal** visible in the chat header.
- Dictate (or bridge inject): `"Hello Umar Mishal, how are you?"`
- **Expected paste / finalText:** `Hello Ummer Mishal, how are you?`
- **Expected log proof (all required):**
  ```
  [ripple-screen-bias] ocr_fallback … OR gather with headerTerms
  [ripple-screen-bias] headerTerms=[Ummer Mishal, Ummer, Mishal]   (or equivalent)
  [ripple-screen-bias] appliedFixes=[Umar Mishal→Ummer Mishal]     (or Umar→Ummer + Misal→Mishal)
  [ripple-screen-bias] surface=dictation … fixes=…
  finalText contains "Ummer Mishal"
  ```

**Secondary success cases (must ALL pass before FINAL):**

| # | Scenario | On screen | STT / inject | Expected |
|---|----------|-----------|--------------|----------|
| A | WhatsApp DM header | Ummer Mishal | Hello Umar Mishal | Hello Ummer Mishal |
| A2 | Same | Ummer Mishal | Hello Umar Misal | Hello Ummer Mishal |
| A3 | Same | Ummer Mishal | Hello Humar | Hello Ummer |
| A4 | Same | Ummer Mishal | Hello Umar Masai | Hello Ummer Mishal |
| B | WhatsApp group bubble | ~ Rayan | Hello Rayyan | Hello Rayan |
| C | WhatsApp DM | Anzal Khan | Hello Ansal | Hello Anzal |
| D | Instagram DM | Anzal | Hey Ansal | Hey Anzal |
| N1 | NEGATIVE | Ummer Mishal | Hello Kumar Mishra | **unchanged** Kumar Mishra (no Mishra→Mishal) |
| N2 | NEGATIVE | Liked / Seen chrome | It's like when… | **no** like→Liked |
| N3 | NEGATIVE | Morning bubble | you're not working | **no** working→Morning |

**Known failure modes that MUST stay fixed (regressions = FAIL):**

| Failure | Symptom | Required fix behavior |
|---------|---------|----------------------|
| OCR skipped | `uiaTerms≥2` early return, no ocr_fallback | Always OCR when no confident 2-word header |
| Self-capture | OCR reads Ripple Dashboard | Discard with `ocr_self_capture`; prefer pinned hwnd OCR |
| Half-fix | Umar Misal → Umar Mishal | Full phrase or first-name-anchored phrase fix |
| Wrong fix | Kumar Mishra → Kumar Mishal | Protected name phrases; sidebar noise guard |
| Dist too tight | Umar→Ummer blocked | Title-priority + double-letter relax |
| First letter | Humar→Ummer blocked | Allow for title-priority phonetic near-miss when header exists |
| Timeout | ocrChars=0 / no_terms | Adequate OCR budget + log `ocr_ms` every run |
| Editor title as name | Cursor title counted as person | `isPersonNameLike()` rejects paths/dots/digits |

---

DO NOT REGRESS OR MODIFY:
- Insert ladder (clipboard_paste, native_text, modifiers_before_send, target_state, composer_focus)
- Focus / pin (hotkey_pin, press_sequence, main_suppress, restoreFocusContext, focus drift)
- Chrome insert path under `electron/focus/` or insert orchestration
- Meeting Notetaker, Dev Mode file tagging / variable recognition, F9 transforms
- Jarvis — stay off; never gate screen bias on Jarvis
- Do not weaken abort/acceptance rules in insert verify to “make bias look green”

**Allowed touch surfaces ONLY:**
- `electron/agent/dictation/screenNameBias.ts` (primary)
- `electron/agent/dictation/prepareComposeText.ts` (wiring / always-on call only)
- `electron/agent/dictation/__tests__/phase-p7-7-screen-name-bias.spec.ts`
- Optional test-only harness under `scripts/` or `electron/agent/dictation/__tests__/` — **delete before FINAL**
- `docs/WISPR-FLOW-GAP-ANALYSIS.md` row 20 (status only)
- Final report: `ripple-desktop/cursor/SCREEN-BIAS-REPORT.md`

---

VERIFY (must ALL be true to stop — unchecked = keep looping):

### A. Unit / code
- [ ] `npx vitest run electron/agent/dictation/__tests__/phase-p7-7-screen-name-bias.spec.ts` — all green
- [ ] Tests exist and pass for: A, A2, A3, A4, B, C, N1, N2, N3 (inject fixture OCR text; do not require live mic for unit)
- [ ] Typecheck: zero **new** errors in touched files (`tsc --noEmit` scoped; pre-existing unrelated drift excluded)
- [ ] `git diff` shows no changes under `electron/focus/`, insert ladder, overlay press path (unless stack proves necessary — then document)

### B. Live or bridge WhatsApp (blocking)
- [ ] **Test A** with Ummer Mishal chat actually foreground: log shows `headerTerms` + `appliedFixes` + `finalText` with Ummer Mishal
- [ ] **Test N1** Kumar Mishra stays unchanged (log has no `Mishra→Mishal`)
- [ ] **Test A2 or A4** phrase near-miss fully corrected
- [ ] Warm-session: 3 WhatsApp dictations + 1 Cursor — insert still works, no crash

### C. Log signals (every bias run)
- [ ] Every WhatsApp dictation emits at least one `[ripple-screen-bias]` line (never silent skip)
- [ ] When UIA has no person header: `ocr_fallback` or equivalent gather path with `ocr_ms=`
- [ ] Self-capture discarded with explicit `ocr_self_capture` if Ripple UI was on top
- [ ] Failures fail-open: utterance unchanged, dictation still inserts

### D. Docs
- [ ] Gap analysis row 20 updated with honest status + link to SCREEN-BIAS-REPORT.md
- [ ] SCREEN-BIAS-REPORT.md written per UNATTENDED FINAL REPORT section below

---

IMPLEMENTATION CHECKLIST (complete in order; one item per iteration when possible):

1. [ ] Active chat **header priority** from OCR (2-word First Last at chat top)
2. [ ] Full-phrase correction before token scatter
3. [ ] First-name anchor for phrase identity (`Umar …` ↔ `Ummer …`)
4. [ ] Relaxed fuzzy for title-priority (double-letter, dist+1)
5. [ ] Sidebar noise + protected phrases (no half-correct of unmatched First Last)
6. [ ] Skip phone composer hints as names (`Type a message to +971…`)
7. [ ] OCR when no confident header (do not early-return on UIA junk)
8. [ ] Pinned-window OCR + Ripple self-capture discard
9. [ ] Log: `headerTerms`, `appliedFixes`, `ocr_ms`, reject reasons
10. [ ] Group bubble names (`~ Rayan`) extracted from OCR
11. [ ] Unit fixtures for A–D and N1–N3
12. [ ] Live/bridge Test A + N1 proof in report

If code already has items 1–9 (see existing SCREEN-BIAS-REPORT.md), **do not re-implement** — verify they still pass, then finish **10–12** (Rayan + live proof + report refresh).

---

LOOP PROTOCOL — repeat each pass until FINAL:

1. **DISCOVER**
   - Read `screenNameBias.ts`, `prepareComposeText.ts`, latest `terminals/*.txt`, existing `SCREEN-BIAS-REPORT.md`.
   - Run unit suite; list failing cases.
   - Quote exact failing log lines (never paraphrase without the line).

2. **PLAN**
   - Pick the single highest-impact failing VERIFY item or next unchecked IMPLEMENTATION item.
   - Smallest diff only.

3. **EXECUTE**
   - Implement + add/update unit test for that exact failure.
   - No drive-by refactors.

4. **VERIFY**
   - Run vitest for screen-name-bias.
   - Run live or `__ripple_dictate__` bridge test for Test A if possible; scrape log.
   - Confirm git scope (no insert/focus churn).

5. **DECIDE**
   - All VERIFY checked → print **`FINAL — done`** and write/update SCREEN-BIAS-REPORT.md
   - Else → print **`ITERATING — [exact failing verify + log excerpt]`** and go to step 1

---

STOP CONDITIONS:
- **Success:** every VERIFY checkbox true; Test A + N1 proven with log excerpts; unit suite green.
- **Hard limit:** after **12 iterations**, stop regardless. Report must list remaining failures with log evidence and the next concrete fix. Do not invent a pass.

---

RULES:
- Never claim success without log proof containing `Ummer Mishal` in `finalText` / `appliedFixes` for Test A (or an explicit block: Windows FG refusal + captured OCR sample of what WAS on screen).
- Fail-open always — bias errors must never block insert.
- Do not increase OCR budget beyond ~500ms without measuring and noting `ocr_ms` in the report.
- Don't ask questions mid-loop.
- Hot reload OK for code; FINAL requires Test A evidence, not unit alone.
- Entire-screen / pinned-hwnd OCR — never bias from Ripple's own dashboard when it occludes the chat.
- If WhatsApp cannot be forced to foreground (WA_FG=False), document it, use OCR fixture + last known good live log, and still finish unit + N1; mark Test A as “needs human FG” only after 2 automated FG attempts fail — then continue other VERIFY items; FINAL may only be claimed if Test A previously passed in this report OR human confirmation is recorded.

---

ADDITIONAL PROTOCOL — AUTOMATED / UNATTENDED VERIFICATION (user may be away):
*(Adapted from `cursor/analysed.md` — same discipline, different signals.)*

You cannot rely on human eyes for every pass. Verify programmatically:

1. **OCR FIXTURE HARNESS (test-only — delete before FINAL if temporary scripts added)**
   - Prefer unit tests that inject OCR text strings:
     - Fixture `"Ummer Mishal\nChats\nKumar\nType a message…"` + utterance `"Hello Umar Mishal"` → must become Ummer Mishal
     - Fixture with sidebar noise + utterance `"Hello Kumar Mishra"` → must stay Kumar Mishra
     - Fixture `"~ Rayan\nMorningg\nTeam | Project Ripple"` + `"Hello Rayyan"` → Rayan
   - Optional Node script under `scripts/` that calls exported `extractCandidateTerms` / `applyScreenNameBias` — remove before FINAL if not kept as permanent vitest.

2. **LOG SCRAPE (required every live/bridge pass)**
   - Required sequence when bias should fire:
     `dictation:execute` → `[ripple-screen-bias]` gather/ocr → `headerTerms=` and/or `appliedFixes=` / `fixes=` → `dictation-decision` `finalText`
   - PASS Test A: `finalText` includes `Ummer Mishal` AND fixes include phrase or token path to Ummer.
   - FAIL: `Mishra→Mishal` on Kumar input; silent absence of all `[ripple-screen-bias]` lines on WhatsApp High cleanup; `ocr_self_capture` without retry/discard when Ripple UI was OCR’d as names.

3. **WINDOW / TARGET SANITY (backup — do not expand into insert fixes)**
   - Confirm voice target is Chrome WhatsApp (`whatsapp=true` or title contains WhatsApp) for Test A.
   - If FG is Cursor/Ripple during “WhatsApp test”, that run is **INVALID** for Test A — mark INVALID, do not count as FAIL of the feature, re-run with correct FG.

4. **Add both fixture + log scrape to VERIFY** — unit fixtures alone ≠ FINAL; need at least one valid WhatsApp-FG run OR documented human confirmation in the report.

5. **UNATTENDED FINAL REPORT** — when you print FINAL (or hit iteration limit), write/overwrite:

   **`ripple-desktop/cursor/SCREEN-BIAS-REPORT.md`**

   Must contain:
   - PASS/FAIL per VERIFY checkbox
   - Live/bridge results for A, A2/A4, N1, B (if attempted) with **verbatim log excerpts**
   - Unit command + pass count
   - Root causes fixed (file:line bullets)
   - Before/after table: Humar, Umar Misal, Umar Masai, Kumar Mishra, Rayyan
   - OCR latency (`ocr_ms`) notes
   - Files changed (one line each)
   - Anything still broken with evidence line
   - Confirmation: no insert/focus production paths modified (or list exceptions with reason)
   - Cleanup: temporary harness/scripts deleted if added
   - **Last line exactly:**  
     `Recommended: one human-observed WhatsApp dictation (Ummer Mishal chat, FG) as final confirmation.`

   The user will read SCREEN-BIAS-REPORT.md when they return — one read must answer: “is #20 done, and how do you know?”

RULES ADDITIONS (from analysed.md pattern):
- Any temporary screenshot/OCR debug harness is test-only: never ship in production paths; remove before FINAL.
- If OCR/capture fails on this machine, say so explicitly in the report and fall back to fixtures + last valid log — never silently skip and claim PASS.
- Even with all automated checks green, keep the recommended human line as the last line of the report.

---

EDGE CASES TO COVER IN TESTS (from production matrix — screen-bias slice):

| ID | Case | Expected |
|----|------|----------|
| SB.1 | Multi-word phrase near-miss | Longest / phrase match first |
| SB.2 | Overlapping sidebar vs header | Header wins |
| SB.3 | Phonetic similar different person (Kumar vs Ummer) | No over-correct |
| SB.4 | Unicode names if on screen (Zoë) | Match if OCR returns them |
| SB.5 | Group ~prefix names | Strip `~` then match |
| SB.6 | Ripple dashboard occluding chat | Self-capture discard, no menu-label bias |

---

REFERENCE FILES:

```
electron/agent/dictation/screenNameBias.ts
electron/agent/dictation/prepareComposeText.ts
electron/agent/dictation/__tests__/phase-p7-7-screen-name-bias.spec.ts
docs/WISPR-FLOW-GAP-ANALYSIS.md          ← row 20
cursor/SCREEN-BIAS-REPORT.md             ← write on FINAL
cursor/analysed.md                       ← protocol pattern (this file mirrors it)
```

Evidence: prior terminals logs (Ummer Mishal / Rayyan sessions); existing SCREEN-BIAS-REPORT.md for already-landed fixes — verify still green, finish remaining gaps.

---

Begin. Run the loop until FINAL or the iteration limit (12). Do not stop after one pass. Do not stop after unit tests only. Do not stop until Test A + N1 are proven or the hard limit is hit with an honest incomplete report.
