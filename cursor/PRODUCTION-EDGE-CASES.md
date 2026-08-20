# Ripple — Production Readiness Edge Case Matrix (MASTER)

**Supersedes `cursor/C`.** Every row from that file is carried over here with its status updated, plus every bug class discovered during the focus/crash/screen-bias debugging sessions.

## How to use this

Each row is **one test you actually run**, not a theory. Columns:

- **Status** — `✅ VERIFIED` (proven with logs/tests), `⚠️ PARTIAL` (works but with a known caveat), `❌ UNTESTED`, `🐞 KNOWN BUG`
- **Log signal** — the exact string to grep in the dev console. **If the signal is missing, the test FAILS even if the UI looked fine.** That rule is what caught most bugs in this project.

**Global setup for every run:**
```
npm run dev
# logs → dev console;  crash logs → %LOCALAPPDATA%\Ripple\logs\
# optional deep OCR diagnostics:  set RIPPLE_SCREEN_BIAS_DEBUG=1
```

**Two rules learned the hard way:**
1. A green UI with a missing/failed log line is a **fail**. Verify from logs, not vibes.
2. Any test involving "first dictation after launch" requires a **full process kill** (`electron.exe` **and** `ripple-native.exe` in Task Manager). A dev hot-reload does not reproduce first-run bugs.

---

# 1. PRESS PATH — hotkey → pin → overlay (highest-risk area)

Every bug here presented to the user as "the screen flickers / my window goes off / focus is lost".

| # | Edge case | Steps | Expected | Log signal | Status |
|---|---|---|---|---|---|
| 1.1 | **Press hotkey in Notepad** | Focus Notepad, press hotkey | Caret **stays** in the text area; menu bar does NOT activate | `press_reassert=skip_fg_match`, `press_sequence` all 3 snapshots equal, **no** `press_reassert=focus` | ✅ VERIFIED (5×) |
| 1.2 | **Press hotkey in Cursor/VS Code** | Focus editor, press hotkey | Caret stays; no menu bar flash | same as 1.1 | ✅ VERIFIED |
| 1.3 | **Press hotkey in Chrome** | Focus Chrome composer, press hotkey | No change in focus/z-order | same as 1.1 | ✅ VERIFIED |
| 1.4 | **Regression guard: no Alt injection** | Any app with a menu bar (Notepad, Explorer, Word) | Alt menu never arms on press | `press_reassert=skip_fg_match` present; sidecar shows no focus ritual | ✅ VERIFIED — root cause was `synthetic_alt_tap()` (VK_MENU) at press |
| 1.5 | **Press with Ripple dashboard visible but unfocused** | Open Ripple window, click away to Notepad, press hotkey | Nothing surfaces from behind; z-order unchanged | `main_suppress branch=visible_native_noactivate` (NOT `focused_yield`) | ✅ VERIFIED |
| 1.6 | **Press while Ripple dashboard HAS focus** | Click Ripple window, press hotkey | Yields cleanly to last real app | `main_suppress branch=focused_yield` | ⚠️ PARTIAL — pin may land on the previously-focused app; confirm it's the one you want |
| 1.7 | **Boot-time window pop (dev only)** | Kill both processes, `npm run dev` while logged in, watch your focused app | Dashboard appears **without** taking foreground | **no** `main window open` line; foreground unchanged | ✅ **FIXED + VERIFIED 3/3** — dev branch now `showInactive()` instead of `showMainWindow({userInitiated:true})` (which ran setAlwaysOnTop→show→focus→moveTop). Evidence: `RUN1/2/3 FOCUS_KEPT=True window_open_lines=0`. Login + tray/activate paths still activate intentionally |
| 1.8 | **Rapid double-press (<500 ms)** | Press hotkey twice fast | Second press = "stop", not a new session; pin snapshotted once | `sessionStateGuards.spec.ts` — `startDictationSession` called once, `snapshotPreVoiceTarget` called once | ✅ VERIFIED (code path) |
| 1.9 | **Press while previous insert in-flight** | Dictate long text, press again during insert | Blocks/queues/cancels cleanly — never races | no interleaved `strategy=` lines | 🐞→✅ FIXED — overlapping inserts DID interleave (proved: 5 alternating runs). Now serialized via a bounded queue; `concurrentInsert.spec.ts` 4/4 |
| 1.10 | **Triple-tap = Meeting** | Tap dictation hotkey 3× within 850 ms | Meeting starts, not 3 dictations | `handleMeetingShortcutPress` path | ❌ UNTESTED |
| 1.11 | **Press on secondary monitor** | Move target to 2nd monitor, press | Overlay on correct monitor; no shell steal | `press_sequence` equal; no `insert_fg_shell` | ❌ UNTESTED |
| 1.12 | **Press right after Win+L unlock** | Lock, unlock, immediately press | No false shell-steal, no crash | `press_sequence` equal | ❌ UNTESTED |
| 1.13 | **Press with Alt+Tab switcher open** | Hold Alt+Tab, press hotkey | No false abort/yank | no `target_window_changed` | ❌ UNTESTED |
| 1.14 | **Press with Windows notification toast on screen** | Trigger a toast, press | Toast not mistaken for target change | `hotkey_pin pin_source=live_fg` on the real app | ❌ UNTESTED |
| 1.15 | **Press with Snap Layouts / FancyZones tiling** | Tile windows, press | Target + overlay unaffected | `press_sequence` equal | ❌ UNTESTED |
| 1.16 | **Monitor unplugged mid-session** | Dictate, unplug external monitor, dictate again | Re-resolves topology; no crash/misplaced overlay | no crash log | ❌ UNTESTED |
| 1.17 | **Display scaling 125/150/200%** | Change scaling, press | Overlay positioned correctly | visual | ❌ UNTESTED |

---

# 2. TARGET RESOLUTION — which window gets the text

| # | Edge case | Steps | Expected | Log signal | Status |
|---|---|---|---|---|---|
| 2.1 | **Switch windows mid-dictation** | Press in WhatsApp, speak, click Cursor before insert | **Aborts** — never yanks your window back | `insert_aborted reason=target_window_changed … (no force-foreground)` + clipboard + toast | ✅ VERIFIED |
| 2.2 | **5+ Chrome windows open** | Multiple Chrome windows, dictate into one | Correct window by **hwnd**, not process name | `hotkey_pin … pinned=chrome:<hwnd>` matches the one you used | ✅ VERIFIED |
| 2.3 | **Stale pin from previous session** | Dictate in A, wait, dictate in B | Pin re-reads live foreground; stale cache dropped | `stale_cache_dropped=1` | ✅ VERIFIED |
| 2.4 | **Target minimized mid-speech** | Dictate, minimize target before insert | Aborts, no paste into nothing | `target_gate … iconic=1 … refusing send` → `insert_aborted:target_not_visible` | ✅ VERIFIED (unit) / ❌ live |
| 2.5 | **Target window CLOSED mid-dictation** | Dictate, close the window entirely | Detects invalid hwnd, aborts safely | abort + clipboard, no crash | ✅ VERIFIED — `insert_aborted:target_not_visible` for all 3 strategies; text rescued to clipboard + toast; transient blip does NOT false-abort. `windowClosedMidDictation.spec.ts` 7/7 |
| 2.6 | **Win11 Notepad reports `visible=0`** | Dictate into Notepad | Must still insert — foreground ⇒ reachable | `target_state visible=0 iconic=0 fg_now=Notepad:<same hwnd>` and insert **proceeds** | ✅ VERIFIED — gate keyed on iconic OR (hidden AND not-foreground) |
| 2.7 | **Occluded but not minimized target** | Cover target with another window, dictate | Still works — occlusion ≠ not-foreground | `strategy=… status=ok` | ⚠️ PARTIAL — insert OK, but **screen-bias OCR reads the covering window** (see 5.7) |
| 2.8 | **Dictate with Ripple dashboard covering the target** | Open dashboard over WhatsApp, dictate | Insert OK; bias must not read Ripple's own UI | `ocr_self_capture` warning, bias skipped | ✅ VERIFIED (guard added) |

---

# 3. INSERT LADDER / TEXT LANDING

| # | Edge case | Steps | Expected | Log signal | Status |
|---|---|---|---|---|---|
| 3.1 | **Chrome / WhatsApp Web composer** | Dictate into WhatsApp | Text lands exactly | `clipboard_check len=… hash8=…` → `paste_send result=ok` → `strategy=clipboard_paste status=ok` | ✅ VERIFIED |
| 3.2 | **Notepad (native_text)** | Dictate into Notepad | Exact text in buffer | `strategy=native_text status=ok` | ✅ VERIFIED (read back via UIA: exact match) |
| 3.3 | **Cursor / VS Code AI chat box** | Dictate into Cursor chat | Text lands; not falsely rejected | `paste_landing=indeterminate_no_value … accepting` | ✅ VERIFIED — control exposes no UIA value, so verification is impossible by design |
| 3.4 | **Cursor terminal focus stealing** | Dictate into Cursor while a terminal panel is active | Text goes to intended control | `verify_after_focus role=… name="Terminal …"` = **FAIL** | 🐞 SEEN ONCE — verify_after showed the terminal, not the chat box |
| 3.5 | **Paste into field with existing text (cursor mid-sentence)** | Put caret mid-text, dictate | Inserts at caret; does not select-all/overwrite | `strategy=… status=ok` + visual | ❌ UNTESTED |
| 3.6 | **Paste with text SELECTED** | Highlight text, dictate | Deliberate behavior (replace or insert) — documented either way | visual | ❌ UNTESTED |
| 3.7 | **Very long dictation (500+ chars)** | Speak 500+ chars into a slow web app | **Every** character delivered, no loss/duplication | `chunkLeakGuard.spec.ts` reassembles all chunks and asserts byte-identical to input | ✅ VERIFIED (code path) — live confirmation still recommended in a slow web app |
| 3.8 | **Partial text leak on mid-send abort** | Long dictation, switch window mid-send | **Zero** characters land in wrong app | `foreground changed BEFORE chunk 1/5 … sentChars=0` → `insert_aborted:foreground_changed_mid_send:sentChars=0` | ✅ **FIXED + VERIFIED** — check moved to the START of every chunk (was only *between* chunks, so chunks 1–2 always went out unverified → the 111/250 Instagram leak). Tests: `chunkLeakGuard.spec.ts` proves 0 sends when focus already wrong |
| 3.9 | **Very short dictation (1–2 words)** | Say "okay" | No disproportionate lag | latency in `dictation-decision` | ❌ UNTESTED |
| 3.10 | **Read-only / disabled field** | Dictate into a disabled input | Clean abort, not silent failure | `focus_not_editable:…` | ⚠️ PARTIAL |
| 3.11 | **Live-validating field (numeric only, char limit)** | Dictate into a numeric field | Graceful abort or partial-accept, signalled | any abort reason + toast | ❌ UNTESTED |
| 3.12 | **iframe-embedded rich text editor** | Dictate into an iframe editor | Works or fails loud — never silent | `strategy=` line present | ❌ UNTESTED |
| 3.13 | **All strategies fail** | Force all to fail | Text on clipboard + toast, zero data loss | `insert ladder exhausted` + clipboard hint | ⚠️ PARTIAL |
| 3.14 | **Clipboard preservation** | Copy something important, dictate, check clipboard | Original clipboard restored | `clipboard_restored len=…` | ✅ **FIXED + VERIFIED** — snapshot before write, restore 700 ms after the paste lands (never before, so it cannot race the target reading it). Tests: `clipboardRestore.spec.ts` incl. paste-then-restore ordering |
| 3.15 | **Clipboard read-back mismatch** | Dictate while another app owns clipboard | Detects + rewrites | `clipboard_rewrite=1` or `MISMATCH_AFTER_REWRITE=1` | ✅ VERIFIED (code path) / ❌ live |
| 3.16 | **Modifier held at send time** | Hold Ctrl/Shift/Win, trigger insert | Refuses while **Win** down; waits 300 ms then aborts | `modifiers_before_send win=1` → `insert_aborted:modifier_win_down` | ✅ VERIFIED (unit) / ❌ live |
| 3.17 | **Win11 autocorrect corrupts SendInput** | Dictate long text into Notepad repeatedly | No character substitution | 🐞 `"focus"` → `"cccus"` observed once | 🐞 INTERMITTENT — known race in `send_input.rs` (20 ms/char) |
| 3.18 | **RTL insert (Urdu/Arabic)** | Dictate Urdu into Notepad/Chrome/Word | Correct direction, caret, no reversal | visual per app | ❌ UNTESTED |
| 3.19 | **Devanagari / CJK rendering** | Dictate Hindi, Chinese | No tofu boxes | visual per app | ❌ UNTESTED |
| 3.20 | **Double-insert guard** | Force a verify failure after a successful send | Never re-emits full string | `accepting committed insert to avoid duplicate` | ✅ VERIFIED |

---

# 4. CRASH / PROCESS STABILITY

| # | Edge case | Steps | Expected | Log signal | Status |
|---|---|---|---|---|---|
| 4.1 | **First dictation after full kill + relaunch** | Kill both processes, relaunch, dictate | App stays alive | 3/3 clean runs; no new `crash-*.log` | ✅ VERIFIED (3× + warm 6×) |
| 4.2 | **Renderer + Audio Service crash** | Long session with mic use | Auto-recovers, window reloads | `renderer.process_gone reason=crashed exitCode=-1` + `Audio Service` → `renderer_reloaded attempt=n/3` | ✅ ROOT CAUSE CAPTURED + recovery added |
| 4.3 | **Crash loop protection** | Force 4+ renderer crashes in 5 min | Stops reloading after 3 | `renderer_reload_giveup` | ❌ UNTESTED |
| 4.4 | **Sidecar dies independently** | Kill `ripple-native.exe` only | Detected, respawned, degraded-mode indicator | `sidecar_exit` breadcrumb; `sidecar.process_error` if spawn fails | ⚠️ PARTIAL — `child.on('error')` added (was a fatal unhandled event) |
| 4.5 | **Backend unreachable mid-session** | Stop backend after boot | Graceful degradation, clear error, no hang | `GET /health -> FAIL` then recovery | ⚠️ PARTIAL |
| 4.6 | **Sleep / wake mid-dictation** | Sleep machine mid-speech, wake | No corrupt state; hotkey works | no crash log | ❌ UNTESTED |
| 4.7 | **Low memory / high CPU** | Load machine, dictate | Works or fails gracefully | no crash log | ❌ UNTESTED |
| 4.8 | **Update/restart during in-flight dictation** | Restart app mid-dictation | No data loss/corrupt install | — | ❌ UNTESTED |
| 4.9 | **`electron-audio-loopback` at boot** | Every launch | Patches Chromium audio even if Meeting never used | `[ripple-meeting] electron-audio-loopback initialized` | 🐞 SUSPECTED CAUSE of 4.2 — should be lazy |
| 4.10 | **Crash logger survives hard exit** | Force a crash | Trace written **before** exit | `crash-<ts>.log` exists with stack | ✅ VERIFIED (synchronous writes) |

---

# 5. CONTEXT-AWARE SPELLING (#20 screen bias)

| # | Edge case | Steps | Expected | Log signal | Status |
|---|---|---|---|---|---|
| 5.1 | **Near-miss first name** | Chat = `Ummer Mishal`, say "Hello Umar" | → `Hello Ummer` | `fixes=Umar→Ummer` | ✅ VERIFIED LIVE |
| 5.2 | **Full phrase both words wrong** | Say "Umar Masai" / "Umar Misal" | → `Ummer Mishal` (both fixed together) | `fixes=Umar Masai→Ummer Mishal` | ✅ VERIFIED LIVE |
| 5.3 | **Silent-H drift** | Say "Humar" | → `Ummer` | `fixes=Humar→Ummer` | ✅ VERIFIED LIVE |
| 5.4 | **Doubled letter** | Chat = `Rayan`, say "Rayyan" | → `Rayan` | `fixes=Rayyan→Rayan` | ✅ VERIFIED (unit) |
| 5.5 | **Short contact name vs OCR noise** | Chat = `Mehrin`, page full of long text, say "Mehreen" | → `Mehrin` | `headerTerms=[Mehrin, …]` + `fixes=Mehreen→Mehrin` | ✅ FIXED (header terms now always candidates) — **re-verify live** |
| 5.6 | **Wrong person — must NOT change** | Chat = `Ummer Mishal`, say "Kumar Mishra" | unchanged | **no** `fixes=` line | ✅ VERIFIED LIVE |
| 5.7 | **Occluding window poisons OCR** | Cover chat with another app, dictate | Must not bias toward the covering window's text | 🐞 `headerTerms=[Professional Jewelry, ZBRUSH JEWELRY…]` from a shopping page | 🐞 KNOWN LIMIT — OCR reads whatever is visible; only Ripple's own UI is filtered |
| 5.8 | **Ripple's own UI captured** | Dashboard over chat, dictate | Discarded, never used as bias source | `ocr_self_capture` | ✅ VERIFIED |
| 5.9 | **Already-correct name untouched** | Chat = `sairaj Dev`, say "Sairaj" | unchanged | no `fixes=` | ✅ VERIFIED LIVE |
| 5.10 | **Two names in one utterance** | Chat = `Amaal Ahamed`, say "Amal, Ahmed" | both fixed | `fixes=Ahmed→Ahamed, Amal→Amaal` | ✅ VERIFIED LIVE |
| 5.11 | **Emoji in contact name** | Chat = `Haydian🎧 Davy`, say "Hayden" | → `Haydian` | `fixes=Hayden→Haydian` (may pass via `HaydianO`) | ⚠️ PARTIAL — OCR reads emoji as a letter; net result correct |
| 5.12 | **Ordinary sentence, no names** | "Please send the report by Friday morning" | untouched | no `fixes=` | ✅ VERIFIED LIVE |
| 5.13 | **Never bias to UI chrome** | Instagram/WhatsApp with "Liked"/"Seen"/"Morning" visible | `like`↛`Liked`, `working`↛`Morning` | no such `fixes=` | ✅ VERIFIED (unit) |
| 5.14 | **8 arbitrary contacts** | Fatima Sheikh, Rahul Verma, Aisha Khan, Sandeep Nair, Zainab Ali, Priya Menon, Hassan Raza, Nikhil Joshi | each near-miss corrected | unit suite | ✅ VERIFIED (unit) |
| 5.15 | **No duplicated surname** | Chat = `Aisha Khan`, say "Ayesha Khan" | → `Aisha Khan` (not `Aisha Khan Khan`) | — | ✅ FIXED — multi-word target no longer matches a single token |
| 5.16 | **OCR latency budget** | Any dictation | OCR completes within budget | `ocr_ms=` (observed 89–353 ms) | ✅ VERIFIED |
| 5.17 | **OCR timeout / empty** | Heavy machine load | Never silent — logs and fails open | `ocr_empty … budget=` | ✅ VERIFIED |
| 5.18 | **Group chat sender names** | Group with `~ Rayan` bubbles | Corrects toward sender name | `headerTerms=` includes sender | ❌ UNTESTED LIVE |
| 5.19 | **Instagram DM** | IG DM with `Anzal`, say "Ansal" | → `Anzal` | `fixes=Ansal→Anzal` | ❌ UNTESTED LIVE |
| 5.20 | **Gmail compose** | Gmail with a name visible | corrects | `fixes=` | ❌ UNTESTED |
| 5.21 | **Chat switch invalidates header cache** | Dictate in chat A, switch to B, dictate | Uses B's name, not A's | `headerTerms_from_cache` must NOT show A's name | ❌ UNTESTED |
| 5.22 | **Privacy: chat text in logs** | Enable `RIPPLE_SCREEN_BIAS_DEBUG=1` | Sample of on-screen text is logged | `debug_sample=` | ⚠️ BY DESIGN — env-gated, off by default. Confirm it's never on in production |

---

# 6. CORRECTION ENGINE / DICTIONARY / SNIPPETS

| # | Edge case | Expected | Status |
|---|---|---|---|
| 6.1 | Multi-word phrase correction ("play show" → "Play Store") | Longest-match-first wins | ⚠️ RE-VERIFY after refactors |
| 6.2 | Two overlapping correction rules | Deterministic precedence, no double-application | 🐞→✅ FIXED — a later rule re-corrected an earlier rule’s OUTPUT (`"ana maria"`→`Ana-María`→`Anna-María`). Now single-pass over the original text |
| 6.3 | 100+ dictionary entries | No latency regression | 🐞→✅ FIXED — hard `LIMIT 100` silently dropped entries still shown in the dictionary UI. Raised to 2000; 120 entries correct in <250ms |
| 6.4 | "no no" course-correction + name correction together | Both apply, no interference | ❌ UNTESTED |
| 6.5 | Phonetically similar but different word | Correct word wins; no over-correction | ✅ VERIFIED — `mehreen`→`Mehrin` fires; `marine`/`meringue`/`mehreena` untouched |
| 6.6 | Unicode dictionary names (`Zoë`, `Núñez`) | Stored/matched, no encoding corruption | 🐞→✅ FIXED — ASCII `\b` meant non-ASCII spoken forms (`josé`) NEVER matched. Now unicode-aware boundaries; idempotent re-runs |
| 6.7 | Snippet expansion ("sig" → signature) | Expands from current utterance, not accumulated buffer | ⚠️ RE-VERIFY |
| 6.8 | Snippet + screen-bias in one utterance | Both apply cleanly | ❌ UNTESTED |
| 6.9 | Dictionary entry conflicting with a chat contact name | Deliberate precedence | ✅ VERIFIED — `sam`→`Samantha` fires; `same`/`samsung`/`sample` untouched |

---

# 7. LANGUAGE / STT

| # | Edge case | Expected | Status |
|---|---|---|---|
| 7.1 | **English misdetected as Sindhi/Urdu/Nynorsk** | Guard corrects every time, zero user impact | 🐞 RECURRING — seen as `detected=sindhi/urdu/nynorsk` on plain English; `language_override` catches it downstream, root cause unfixed |
| 7.2 | Code-switched English + Hindi | Correct mixed-script output | ⚠️ PARTIAL |
| 7.3 | Romanized Hinglish | Known limit disclosed, not silently garbled | ⚠️ ACCEPTED LIMIT |
| 7.4 | Background noise / multiple speakers | Graceful degradation, no confident garbage | ❌ UNTESTED |
| 7.5 | Whispered / very quiet speech | Works or flags low confidence | ❌ UNTESTED |
| 7.6 | Pinned language vs different spoken language | Reasonable output, no force-garble | ❌ UNTESTED |
| 7.7 | Very long single utterance (60 s+) | No truncation | ❌ UNTESTED |
| 7.8 | Empty / silent recording | Clean "no speech" path | ⚠️ PARTIAL (`no_speech`) |

---

# 8. TRANSFORMS (F9) / DEV MODE / NOTES

| # | Edge case | Expected | Status |
|---|---|---|---|
| 8.1 | F9 with no text selected | Clear "Select text first" hint | ⚠️ PARTIAL |
| 8.2 | F9 rewrite replaces selection in place | Exact in-place swap, no append | ⚠️ RE-VERIFY |
| 8.3 | F9 partial selection inside a longer field | Only the fragment replaced | ⚠️ RE-VERIFY |
| 8.4 | F9 where fragment can't be located | Aborts — never wipes the document | ✅ guarded (`selection_not_found_in_field`) |
| 8.5 | F9 in a contenteditable with no UIA value | Works or aborts loud | ❌ UNTESTED |
| 8.6 | Double-F9 while capture in flight | Debounced | ⚠️ guarded (`transformHotkeyBusy`) |
| 8.7 | Dev Mode file tagging (spoken filename → @file) | Tags correctly | ❌ MISSING FEATURE (gap row 9) |
| 8.8 | Dev Mode camelCase/snake_case variable recognition | Correct casing | ❌ MISSING FEATURE (gap row 10) |
| 8.9 | Quick capture (Ctrl+Alt+N) creates note + dictates into it | Note created, text lands in note not OS field | ❌ UNTESTED |
| 8.10 | Scratchpad from Flow Bar | Same as 8.9 | ❌ UNTESTED |
| 8.11 | Dictation while a Flow Note is open | Routes to note, never to WhatsApp | ⚠️ guarded (`active_note` path) |

---

# 9. MEETING NOTETAKER

| # | Edge case | Expected | Status |
|---|---|---|---|
| 9.1 | Stop before 30 s flush | Graceful "no speech captured" | ✅ VERIFIED |
| 9.2 | **Other audio playing (YouTube/music)** | Scope to meeting app, or warn | 🐞 CONFIRMED BUG — loopback captures everything |
| 9.3 | **Internal prompt text leaking into transcript** | Zero leakage | 🐞 CONFIRMED ONCE ("Preserve speaker content faithfully") |
| 9.4 | Diarization with a REAL second speaker | A/B labels track real voices | ❌ NEVER VALIDATED (all tests were one person) |
| 9.5 | **Summary of garbled transcript** | Flags "unclear", no fabrication | 🐞 CONFIRMED — fabricates coherent narrative from noise |
| 9.6 | **Concrete details preserved** | "3000 rupees, documents missing" not flattened to "personal issues" | 🐞 CONFIRMED ISSUE |
| 9.7 | **Consent / disclosure before recording** | Explicit screen before first record | ⚠️ consent path exists (`isMeetingConsentGranted`) — verify it actually blocks |
| 9.8 | 1 hr+ meeting | No memory growth/degradation | ❌ UNTESTED |
| 9.9 | Network drop mid-meeting | Local buffer, resume, no data loss | ❌ UNTESTED |
| 9.10 | Meeting + dictation hotkey conflict | Dictation hotkey stops meeting, doesn't start a session | ⚠️ handled — verify |

---

# 10. HOTKEYS / INPUT ENVIRONMENT

| # | Edge case | Expected | Status |
|---|---|---|---|
| 10.1 | **Hotkey registration fails (already taken)** | Expected sidecar ownership logged as info; only real conflicts warn | ✅ **FIXED + VERIFIED** — was `hotkey failed: Shift+Space` on every healthy boot, which hid genuine third-party conflicts. Now `hotkey owned by sidecar (Electron backup not needed): …`, and a true conflict logs `hotkey FAILED — likely taken by another app` |
| 10.2 | Sidecar vs Electron double-registration | One press = one event, never two | ⚠️ SEEN — both register; verify no double-fire |
| 10.6 | **Escape cancels cleanly mid-session** | Next press starts a fresh session and re-pins | ✅ VERIFIED — `sessionStateGuards.spec.ts`: after cancel, `startDictationSession`/`snapshotPreVoiceTarget` both fire again (a stale active session was silently blocking re-pin) |
| 10.3 | Third-party app hotkey conflict | Detect + warn | ❌ UNTESTED |
| 10.4 | Non-US keyboard layout | Registration + insertion both work | ❌ UNTESTED |
| 10.5 | Screen reader running (NVDA/JAWS/Narrator) | No a11y-tree contention | ❌ UNTESTED |
| 10.6 | Escape cancels cleanly mid-session | Session ends, pin released, no stuck state | ⚠️ PARTIAL — leaving a session open blocks the next press from re-pinning |
| 10.7 | Hotkey while Jarvis/command mode off | Correct mode; no silent downgrade to planner | ✅ logged (`hotkey_mode_downgrade`) |

---

# 11. SESSION / STATE

| # | Edge case | Expected | Status |
|---|---|---|---|
| 11.1 | 20-minute session window grouping | Utterances grouped correctly | ⚠️ RE-VERIFY |
| 11.2 | Multi-utterance revision buffer ("no, make it X") | Correction applies to right utterance | ⚠️ RE-VERIFY |
| 11.3 | Streaming/progressive insert then final reconcile | No double-insert | ✅ guarded — verify live |
| 11.4 | Undo after insert | Restores previous field text | ❌ UNTESTED |
| 11.5 | Session survives app minimize/restore | State intact | ❌ UNTESTED |

---

# 12. DISTRIBUTION / INSTALL / UPDATE

| # | Edge case | Expected | Status |
|---|---|---|---|
| 12.1 | Antivirus / SmartScreen on install | Signed installer, no scary block | ❌ UNTESTED — **note: Defender AMSI already blocks our screen-capture test scripts on this machine** |
| 12.2 | Upgrade over existing version | Clean, no duplicate processes | ❌ UNTESTED |
| 12.3 | Uninstall completeness | No leftover startup entries/sidecar | ❌ UNTESTED |
| 12.4 | Multiple Windows user accounts | Correct per-user behavior | ❌ UNTESTED |
| 12.5 | Auto-update mid-use | No interruption of active dictation | ❌ NOT WIRED UP |
| 12.6 | Packaged build ≠ dev build behavior | Dev-only branches (1.7) absent | ❌ UNTESTED — **must verify the boot window-pop is gone when packaged** |
| 12.7 | Sidecar binary shipped + signed | `ripple-native.exe` present in `resources/native/win32` | ⚠️ copied by `native:build` — verify in packaged output |

---

# 13. PRIVACY / SECURITY

| # | Edge case | Expected | Status |
|---|---|---|---|
| 13.1 | Where does dictated text transit/log? | Documented: local vs backend vs retention | ❌ NEVER AUDITED |
| 13.2 | `.env` / credential exposure | Rotated; CI secret scanning | 🐞 PAST INCIDENT — confirm old keys dead |
| 13.3 | Meeting audio → cloud disclosure | Explicit before first use | ⚠️ PARTIAL |
| 13.4 | Local history / clipboard fallback encrypted at rest? | Matches promise to users | ❌ UNTESTED |
| 13.5 | **Screen OCR reads whatever is on screen** | Users must know bias reads the screen (may include other people's chats) | ⚠️ **NEW — needs disclosure**, `debug_sample` can log chat text |
| 13.6 | Sensitive text in `%LOCALAPPDATA%\Ripple\logs` | No secrets in crash/lifecycle logs | 🐞→✅ FIXED — no log-file sink exists and crash breadcrumbs carry no user text, BUT `stt_raw`/`command_execute`/`NLU preprocess`/GPT-intent printed the transcript verbatim **in production**. Now length-only unless `RIPPLE_TRANSCRIPT_DEBUG=1`. `transcriptLogPrivacy.spec.ts` 6/6 |

---

# 14. SYNC / MULTI-DEVICE *(defer until Phase 9 ships)*

| # | Edge case | Status |
|---|---|---|
| 14.1 | Two devices editing dictionary simultaneously | ❌ NOT BUILT |
| 14.2 | Sync during intermittent connectivity | ❌ NOT BUILT |
| 14.3 | Account deletion mid-sync | ❌ NOT BUILT |

---

# PRIORITY ORDER

### 🔴 P0 — do before any release
`1.7` (boot window pop), `3.8` (partial text leak into wrong app), `3.14` (clipboard destroyed), `9.2` `9.3` `9.5` `9.6` `9.7` (meeting correctness + consent), `13.2` (secrets), `12.6` (packaged ≠ dev), `4.9` (audio loopback at boot)

### 🟠 P1 — common real usage, not yet proven
`1.8` `1.9` `2.5` `3.5` `3.6` `3.7` `5.5` `5.18` `5.19` `7.1` `10.1` `10.6` `11.4`

### 🟡 P2 — real but lower frequency
`1.11`–`1.17`, `2.4` live, `3.10`–`3.13`, `3.17`–`3.19`, `6.x`, `8.x`, `10.3`–`10.5`, `12.1`–`12.4`

### ⚪ P3 — defer
Section 14, `12.5`

---

# QUICK SMOKE TEST (run this every build — 10 minutes)

1. **Kill both processes** (`electron.exe`, `ripple-native.exe`) → `npm run dev`
2. Focus **Notepad** → press hotkey → **caret stays** → speak → text lands
   - check: `press_sequence` all equal, `strategy=native_text status=ok`
3. Focus **WhatsApp** chat with a known contact → dictate their name slightly wrong
   - check: `headerTerms=[…]`, `fixes=X→Y`, `paste_send result=ok`
4. Dictate, then **click another window mid-speech**
   - check: `insert_aborted reason=target_window_changed`, clipboard has the text, toast shown
5. Dictate into **Cursor** chat box
   - check: `paste_landing=indeterminate_no_value … accepting`
6. Say a **different person's full name** than the open chat
   - check: **no** `fixes=` line
7. `%LOCALAPPDATA%\Ripple\logs\` → **no new `crash-*.log`**

**All 7 pass = safe to ship that build.** Any missing log line = fail, even if the UI looked right.

---

# APPENDIX — log signals cheat sheet

| Signal | Means |
|---|---|
| `press_sequence … fg_before=X fg_after_overlay=X fg_after_session_start=X` | Press stole no focus (all three equal = good) |
| `FG_CHANGED=1` | Press **did** change foreground — investigate |
| `press_reassert=skip_fg_match` | Target already focused; nothing touched (good) |
| `press_reassert=focus` | We forced foreground — only valid when target wasn't focused |
| `main_suppress branch=visible_native_noactivate` | Safe suppression path |
| `main_suppress branch=focused_yield` | Ripple window had focus |
| `hotkey_pin pin_source=live_fg … stale_cache_dropped=1` | Fresh pin, old one discarded |
| `insert_aborted reason=target_window_changed` | User switched windows — correct refusal |
| `insert_aborted:modifier_win_down` | Win key held — refused to send |
| `insert_aborted:target_not_visible` | Target minimized/hidden |
| `insert_aborted:paste_no_effect` | Paste landed nowhere; retried once then gave up |
| `paste_landing=indeterminate_no_value` | Control exposes no value — accepted (Cursor/WhatsApp contenteditable) |
| `clipboard_check len=… hash8=…` | Clipboard verified before paste |
| `ocr_fallback … ocr_ms=` | Screen OCR ran, with timing |
| `ocr_self_capture` | Read Ripple's own window — discarded |
| `headerTerms=[…]` | Active chat name(s) detected |
| `fixes=A→B` | Spelling correction applied |
| `renderer_reloaded attempt=n/3` | Renderer crash auto-recovery |
| `crash-<timestamp>.log` | A real crash with full stack trace |
