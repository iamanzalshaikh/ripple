# Ripple Demo Cheat Sheet — Meeting Ready

**Product story (say this first):**  
Last ~2 months we built **Jarvis (Ctrl+Space)** — voice → plan → tools → Windows actions.  
Now priority is **Wispr Flow (Shift+Space / F9)** — voice typing + transforms, not more automation depth.

**App running:** `npm run dev` in `ripple-desktop`  
**Quit before demo:** ChatGPT Classic / floating overlays that steal focus  

---

## Hotkeys (memorize)

| Key | Mode | Banner | What it does |
|-----|------|--------|----------------|
| **Ctrl+Space** | **Jarvis / Command** | Command | Opens apps, Paint, files, WhatsApp, Gmail, developer workflows |
| **Shift+Space** | **Wispr Flow / Dictation** | Dictation | Types corrected speech into focused field (no planner) |
| **F9** | **Transforms** | Transforms | Highlight text → speak rewrite → replace in place |
| **Esc** | Cancel | — | Abort current voice session |

**Rule to say out loud:** Dictation never wakes Jarvis. Jarvis never types as dictation.

---

# PART A — JARVIS DEMO (Ctrl+Space)

Use these. They map to what we shipped in P4 → P8.5.

## A1. App launch (30 sec — always start here)

| Say | Expect |
|-----|--------|
| `Open Chrome` | Chrome comes forward |
| `Open Notepad` | Notepad opens |
| `Open Paint` | MS Paint opens |
| `Open Calculator` | Calculator opens |

**Context to say:** “Phase 1 / desktop tools — launch any Start Menu app by voice.”

---

## A2. Type + clipboard compounds (1 min)

| Say | Expect |
|-----|--------|
| `Open Notepad and type hello from Ripple` | Notepad + text typed |
| `Open Notepad and type meeting tomorrow at three then select all and copy` | Typed + clipboard has text |
| `Open Notepad and type ripple test then select all and cut` | Cut works |
| `Copy hello demo to clipboard and open Notepad and paste clipboard content` | Paste path |

**Context:** “Compound planner — one sentence, multiple tools (launch + type + keys).”

---

## A3. Paint / visual wow (2 min — best “wow” clip)

| Say | Expect |
|-----|--------|
| `Open Paint and draw a circle` | Circle ink on canvas |
| `Open Paint and draw a square` | Square |
| `Open Paint and draw a triangle and fill it` | Triangle + fill |
| `Open Paint and draw a circle then draw a square` | Multi-draw |
| `Open Paint and draw 2 circles` | Two circles |
| `Open Paint and draw a line then erase it` | Draw + erase *(if erase green)* |
| `Open Paint and clear canvas` | Canvas cleared |

**Context:** “Planner v2 + mouse drag + Paint tools — this is real OS control, not a chatbot.”

---

## A4. Files / OS Control — “hands” (1–2 min)

**Prep:** Put a file named `demo` (or `demo.txt`) in **Downloads**.

| Say | Expect |
|-----|--------|
| `Copy demo from Downloads to Desktop` | File appears on Desktop |
| `Chuck demo onto the Desktop` | Same via slang / Semantic OS |
| `Open Downloads` | Explorer / folder opens |
| `Create a folder called Test Demo on Desktop` | Folder created |
| `Open Notepad as admin` | Admin path / elevate prompt *(show carefully)* |

**Context:** “P5.6 OS Control — copy/move without full paths; Intent Contract, not GPT guessing.”

---

## A5. WhatsApp (1–2 min)

**Prep:** WhatsApp Web logged in; Chrome extension + Native Messaging on; pick a real contact name.

| Say | Expect |
|-----|--------|
| `Message [Contact] saying I'll be late by ten minutes` | Chat opens / message in compose |
| `Send hello to [Contact] on WhatsApp` | Message path |
| `Send demo from Downloads to [Contact] on WhatsApp` | File send compound |

**Context:** “Browser adapters + extension — Ripple uses your real Chrome session.”

---

## A6. Gmail / YouTube / LinkedIn / Notion / Instagram

**Prep:** Logged into each in Chrome.

| Say | Expect |
|-----|--------|
| `Write an email saying thanks for the meeting today` | Gmail compose / body fill |
| `Open Gmail and compose a new email` | Compose window |
| `Search React tutorial on YouTube` | YouTube search |
| `Create a LinkedIn post saying we shipped voice desktop automation` | LinkedIn composer |
| `Open Notion and create a page called Meeting Notes` | Notion page path |
| `Open Instagram` | Instagram tab / surface |

**Context:** “Phase 3.5 / P5 browser tools — WhatsApp, Gmail, YouTube, LinkedIn, Notion, IG.”

---

## A7. Developer mode (show “we built for engineers”)

**Prep:** Have a project folder open in Cursor (e.g. `projectRipple` / `jkf`). Prefer commands after: `Work on projectRipple` or `Open my last project`.

| Say | Expect |
|-----|--------|
| `Always open projects in Cursor` | Preference stored (P6 memory) |
| `Work on projectRipple` | Sticky workspace / opens project |
| `Open my last project` | Reopens last workspace |
| `Run typecheck` | Typecheck in inherited project root |
| `Run lint` | Lint pipeline |
| `Analyze this project` | Scan / analyze path |
| `Analyze outdated dependencies` | `npm outdated` / audit path |
| `Perform a security review` | Security-oriented plan *(not fake lint)* |
| `Create a roadmap to complete this project` | Roadmap / semantic intent |
| `Open Horizon backend, analyze setup` | open_project + analyze *(if path exists)* |
| `her rides means HerRidez` | Learn voice correction (P6) |
| `Forget that` / `Forget context` | Clears sticky context |

**Context:** “P5.4 automation + P5.5 AI tools + P6 memory — developer workflow by voice, with project root memory.”

**Code repair (if overlay offers Apply):**  
After a repair suggestion appears: say you can **Apply** / **Ignore** from overlay — auto-apply when utterance includes apply.

| Say | Expect |
|-----|--------|
| `Fix this TypeScript error and apply the patch` | CODE_REPAIR path + apply *(best with a known broken file)* |

---

## A8. Memory / recall (quick)

| Say | Expect |
|-----|--------|
| `What did I open last?` | Recent context |
| `Find my resume` | File search / semantic |
| `Open my last project` | Sticky workspace |

**Context:** “P6 / P8 semantic memory — Jarvis remembers your machine.”

---

## A9. Hard wall (mandatory 20 sec)

| Step | Do | Prove |
|------|-----|--------|
| 1 | **Ctrl+Space** → `Open Chrome` | Jarvis / Command banner → Chrome |
| 2 | Click Notepad | Focus field |
| 3 | **Shift+Space** → `Hello how are you` | Dictation banner → text only, **no** Chrome/planner |
| 4 | Optional: **Ctrl+Space** → `Open Chrome` again | Agent still works |

**Context:** “Phase 4 / P7 walls — dictation cannot be confused with Jarvis.”

---

# PART B — WISPR FLOW (show after Jarvis — “what we prioritize now”)

## B1. Dictation insert (Shift+Space)

| App | Say |
|-----|-----|
| Notepad | `Hey how are you can we meet tomorrow` |
| Cursor | `Add a comment that this function validates input` |
| WhatsApp compose | `I'll call you in ten minutes` |
| Gmail body | `Thanks for your time today looking forward to next steps` |

## B2. Live correction

| Say | Expect |
|-----|--------|
| `Meet tomorrow no no day after tomorrow` | One final sentence (day after), no scrap typing |
| `I want to meet day after tomorrow no yesterday for coffee` | Corrects to yesterday |

## B3. Personal dictionary / learn name

| Say | Expect |
|-----|--------|
| `Learn nor means Noor` *(or dictionary UI)* | Name stored |
| Then: `Hi nor how are you` | Types `Hi Noor…` |

## B4. Snippets

| Say | Expect |
|-----|--------|
| `sig` | Expands signature |
| `intro` | Expands intro snippet |
| `addr` | Expands address |

## B5. Transforms (F9) — Phase 8

| Steps | Say |
|-------|-----|
| 1. Type a casual sentence in Notepad | — |
| 2. Select all (or partial) | — |
| 3. **F9** | Banner: Transforms |
| 4. Speak | `Make this more formal` |
| 5. **F9** stop | Text replaced in place |
| Partial | Highlight only last phrase → `Make this more emotional` |

---

# PART C — 10-MINUTE MEETING SCRIPT (final)

1. **Opening (30s):** “Built Jarvis agent stack P4–P8.5; now shipping Wispr Flow first.”  
2. **Jarvis (5 min):** A1 Open Chrome → A3 Paint circle → A5 WhatsApp one message → A7 `Work on…` / `Run typecheck` if stable.  
3. **Wall (30s):** A9 Ctrl vs Shift.  
4. **Wispr (3 min):** B1 Notepad dictation → B2 correction → B5 F9 formal.  
5. **Close (30s):** “Next: multi-language (9.5) + quiet STT (9.6) on Windows; Mac/iOS deferred.”

---

# PART D — DO NOT DEMO LIVE (unless rehearsed green)

- Random full-path `Copy C:\Users\...` (prefer spoken: Downloads → Desktop)  
- Admin delete / kill process / uninstall  
- Long “analyze entire monorepo” without project already open  
- Instagram DM if login/extension flaky  
- Anything while ChatGPT overlay is focused  

---

# PART E — ONE-LINE PHASE MAP (if they ask “what did you build?”)

| Phase | What you built | Demo line |
|-------|----------------|-----------|
| P4 | Hard walls | Ctrl ≠ Shift |
| P5.1–5.3 | Files + desktop + browser tools | Open / type / WhatsApp / Gmail |
| P5.4–5.5 | Developer automation + AI tools | typecheck / analyze / repair |
| P5.6 | OS Control hands | Copy demo Downloads → Desktop |
| P6 | Memory + sticky workspace | Always Cursor / last project |
| P7 | Wispr Flow dictation | Shift+Space typing + corrections |
| P8 | Transforms | F9 make more formal |
| P8.5 | Planner v2 + compounds + Paint | Open Paint and draw… |

---

**Print this page. Rehearse A1 + A3 + A5 + A9 + B1 + B5 once before the meeting.**
