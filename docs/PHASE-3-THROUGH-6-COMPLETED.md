# Phases 3–6 — End-to-End Completion Record

**Project:** Ripple Desktop + Backend  
**Last updated:** July 2026  
**Companion docs:** [PHASE-7-AND-P85-COMPLETED.md](./PHASE-7-AND-P85-COMPLETED.md), `ripple/PHASE3_END_TO_END.md`, `ripple/PHASE_3.5_COMPLETE.md`, `ripple/FINAL_IMPLEMENTATION_PLAN.md`

This document records **everything built and working** from Phase 3 through Phase 6 — the path from “voice assistant shell” to “desktop intelligence + search + telemetry” before P7 native and P8.5 planner.

---

## How the phases connect

```
Phase 1–2 (backend)     Auth, sessions, command engine, Whisper, Socket.IO
        ↓
Phase 3                 Electron shell: overlay, tray, hotkey, action runner
        ↓
Phase 3.5               Web app automation (WhatsApp, Gmail, IG, LinkedIn, Notion, YouTube)
        ↓
Phase 4.x               Desktop intelligence: apps, files, aliases, NLU, i18n, safety
        ↓
Phase 5 / 5.5           Retriever chain, Windows Search, knowledge graph, workflows
        ↓
Phase 6                 Command telemetry, observability UI, CI quality gate
        ↓
(P8 / P8b memory)       Last-opened, temporal, semantic recall — shipped alongside 4.5–4.6
        ↓
Phase 7                 Native Rust sidecar (see PHASE-7-AND-P85-COMPLETED.md)
        ↓
P8.5                    Universal intent planner (see PHASE-7-AND-P85-COMPLETED.md)
```

---

# Phase 3 — Desktop Voice Assistant ✅ COMPLETE

**Spec:** `ripple/PHASE3_END_TO_END.md`  
**Role:** Electron app that connects to Phase 2 backend and **executes actions locally**.

## What was built

| Area | Feature | Status | Key files |
|------|---------|--------|-----------|
| **Shell** | Electron app, React UI, system tray | ✅ | `src/`, `electron/main/` |
| **Auth** | Login/signup, JWT in secure storage | ✅ | `electron/auth/`, backend `/auth/*` |
| **Voice** | Global hotkey (Ctrl+Space), overlay | ✅ | `electron/windows/overlay.ts` |
| **Streaming** | Socket.IO voice chunks → Whisper | ✅ | `rippleSocket`, backend `voiceStreaming.service.ts` |
| **Fallback** | REST when socket offline | ✅ | `commandOrchestrator.ts`, `api.ts` |
| **Focus** | Capture window before overlay; restore before paste | ✅ | `electron/focus/focusContext.ts` |
| **Actions** | Run backend `actions[]` locally | ✅ | `electron/automation/actionRunner.ts` |

## Action types executed (Phase 3)

| Action | What desktop does |
|--------|-------------------|
| `INSERT_TEXT` | Type/paste into focused field |
| `COPY_TEXT` | Clipboard copy |
| `OPEN_APP` | Launch or focus app / URL |
| `OPEN_URL` | Browser navigation |
| `WORKFLOW` | Expand and run multi-step batch |
| `SHOW_SUGGESTIONS` | Disambiguation UI |
| `NOOP` | No-op with message |

## Phase 3 UX extras (beyond original MVP weeks)

| Feature | Status |
|---------|--------|
| Gmail compose URL (`to`, `su`, `body`) | ✅ |
| Rephrase / edit **in place** (no new tab) | ✅ `smartInsert.ts`, `rephraseParse.ts` |
| Mini voice indicator (non-focus-stealing) | ✅ |
| Session end on quit/logout | ✅ |
| Command history UI | ✅ |
| `electron-builder` packaging scaffold | ✅ |

## End-to-end flow (Phase 3)

```
Ctrl+Space → snapshot focus → record mic
    → voice:chunk / voice:end (socket)
    → transcript
    → command:execute (socket or REST)
    → command:result + actions[]
    → actionRunner runs each action
    → command:action_ack per action
```

## Backend dependency (Phase 1–2 — prerequisite)

| Layer | Status |
|-------|--------|
| Signup/login, JWT refresh | ✅ `ripple-backend/PHASE1_FINAL.md` |
| Command execute, history, acks | ✅ `ripple-backend/PHASE2_FINAL.md` |
| Intent types: generation, edit, navigation, typing, workflow | ✅ |
| Per-app AI system prompts | ✅ |

---

# Phase 3.5 — Web App Automation ✅ COMPLETE

**Spec:** `ripple/PHASE_3.5_COMPLETE.md`  
**Build:** `phase-3.5.4-linkedin-paste-fix-v9`  
**Extension:** Ripple Bridge v1.6.1

## Executive change

| Before (Phase 3) | After (Phase 3.5) |
|------------------|-------------------|
| AI generates text; user copies manually | Desktop runs real workflows in apps |
| Open URL only | Search contacts, compose, post, play video |
| Backend down = broken | Local routing + overrides when cloud unavailable |

**Slack:** explicitly deferred — not in scope.

## Platform infrastructure

| Component | Purpose | Key files |
|-----------|---------|-----------|
| Focus detection | HWND, title, app flags (Gmail, WA, IG, …) | `focusContext.ts` |
| Extension tab URL | Enrich generic Chrome titles | Native Messaging `GET_ACTIVE_TAB_INFO` |
| Native Messaging bridge | Port `39731`, framed JSON | `nativeMessagingBridge.ts` |
| Command orchestrator | Local-first per app | `commandOrchestrator.ts` |
| Workflow expander | One WORKFLOW → concrete steps | `workflow/actionExpander.ts` |
| Voice overrides | Replace backend INSERT_TEXT with real actions | `*VoiceOverride.ts` per app |
| Rephrase / tone | In-place edit, never new window | `rephraseParse.ts`, backend rewrite intents |

## Per-app completion

### WhatsApp ✅

| Capability | Status |
|------------|--------|
| Search contact + message | ✅ |
| Send / “and send” | ✅ |
| Fuzzy contact match + confirm | ✅ |
| Rephrase in open chat | ✅ |
| Referential send (“send her the file”) | ✅ `buildReferentialWhatsApp.ts` |
| File attach path | ✅ `whatsappAttachment.ts` (extension) |

**Path:** Chrome extension DOM on `web.whatsapp.com` — not Cloud API.

### Gmail ✅

| Capability | Status |
|------------|--------|
| Compose with to/subject/body (URL + keyboard) | ✅ |
| Open Gmail + write | ✅ |
| Rephrase/tone in compose | ✅ |
| Smart insert routing | ✅ |

### Instagram ✅

| Capability | Status |
|------------|--------|
| Open, message user, search thread | ✅ |
| Rephrase composer | ✅ |
| “and send” | ✅ |

**Out of scope:** posts, stories, reels, group DMs.

### LinkedIn ✅ (with limits)

| Capability | Status |
|------------|--------|
| Open, search people | ✅ |
| Create post (draft + paste) | ✅ |
| Publish best-effort | ✅ |
| Topic-only AI post | 🟡 Needs backend AI |

### Notion ✅

| Capability | Status |
|------------|--------|
| Open, new page + title/body | ✅ |
| Paste clipboard into page | ✅ |
| Contextual new page on tab | ✅ |

### YouTube ✅

| Capability | Status |
|------------|--------|
| Open, search, play by name | ✅ Extension auto-play |

### Desktop baseline (carried into Phase 4) ✅

| Capability | Status |
|------------|--------|
| Open Downloads / Documents / Desktop | ✅ |
| Open file by name (shallow search) | ✅ |

## Chrome extension

**Path:** `ripple-desktop/ripple-chrome-extension/`

| Capability | Apps |
|------------|------|
| DOM automation | WhatsApp, Instagram, LinkedIn, YouTube |
| Active tab URL → desktop | Supported sites |
| Native Messaging | Electron port 39731 |

**Setup:** `WHATSAPP_SETUP.md`

---

# Phase 4 — Desktop Intelligence & Natural Language 🟢 MOSTLY COMPLETE

**Spec:** `ripple/PHASE_4_ROADMAP.md`, `ripple/PHASE_4.6_COMPLETE.md`  
**Build markers:** `phase-4.0-desktop-intelligence-v1`, `phase-4.6-complete`

Phase 4 turns Ripple into a **Windows desktop assistant**: apps, files, memory, multilingual NLU, safety, undo.

---

## 4.8 — Local workflow engine ✅

| Feature | Status | Files |
|---------|--------|-------|
| Desktop commands without backend | ✅ | `buildDesktopCommandResult()` |
| Unified native intent router | ✅ | `parseNativeCommand.ts` |
| Orchestrator checks desktop first | ✅ | `commandOrchestrator.ts` |
| WORKFLOW batch execution | ✅ | `runDesktopOpenBatch()`, `workflowRunner.ts` |
| Offline folder/file open | ✅ | |

---

## 4.1 — Application control ✅

**Files:** `nativeAppRegistry.ts`, `launchApp.ts`, `windowManager.ts`, `parseNativeAppCommand.ts`

| Action | Voice examples | Status |
|--------|----------------|--------|
| Launch built-in Windows apps | Calculator, Notepad, Paint, Snipping Tool, Photos, Camera, Explorer, Clock, Sticky Notes | ✅ |
| Launch dev tools | VS Code, Cursor, Chrome, Edge | ✅ |
| Launch other | Spotify, Discord, Task Manager | ✅ |
| Switch to app | “Switch to Chrome” | ✅ |
| Close app | “Close Spotify” | ✅ |
| Minimize all | “Minimize all windows” | ✅ |
| Start Menu app discovery | Scan installed apps | ✅ `appDiscovery` + file index |

---

## 4.2 — File & folder automation ✅

**Files:** `parseDesktopCommand.ts`, `parseFileOperationCommand.ts`, `fileOperations.ts`, `searchFiles.ts`, `itemResolve.ts`, `openDesktopItem.ts`

### Open & navigate

| Command | Status |
|---------|--------|
| Open Downloads / Documents / Desktop | ✅ |
| Open Pictures / Videos / Music | ✅ |
| Open file by name/extension | ✅ “Open Resume.pdf” |
| Open item in location | ✅ “Open Flow in desktop” |
| Disambiguation (2+ matches) | ✅ Dialog up to 5 choices |

### File operations

| Command | Status | Safety |
|---------|--------|--------|
| Create folder / file | ✅ | Auto |
| Rename file/folder | ✅ | Confirm patterns |
| Move file/folder | ✅ | Confirm when cross-folder |
| Delete file/folder | ✅ | Confirm dialog |
| Duplicate file | ❌ | Not built |

---

## 4.3A — User aliases ✅

**Storage:** `%LOCALAPPDATA%\Ripple\aliases.json`  
**Files:** `aliasRegistry.ts`, `parseAliasCommand.ts`, `autoAlias.ts`

| Command | Status |
|---------|--------|
| Remember alias (voice teach) | ✅ |
| Open my alias | ✅ (beats generic search) |
| List / forget alias | ✅ |
| Auto-alias after 3 opens | ✅ |

---

## 4.3B — Browser workspaces ✅

**Storage:** `workspaces.json`  
**Files:** `workspaceRegistry.ts`, `parseWorkspaceCommand.ts`

| Command | Status |
|---------|--------|
| Open GitHub, Render, Vercel, Gmail, etc. | ✅ Built-in URLs |
| Remember custom repo URL | ✅ |
| Open workspace by alias | ✅ |

---

## 4.3C — User workflows ✅

**Storage:** `workflows.json` + SQLite `workflow_graph` (P5.5)  
**Files:** `userWorkflows.ts`, `parseWorkflowCommand.ts`, `workflowGraph.ts`

| Command | Status |
|---------|--------|
| Remember workflow (teach steps) | ✅ |
| Start / run workflow | ✅ Sequential launch |
| List / forget workflow | ✅ |
| Graph-backed “work mode” | ✅ P5.5 |
| Stop work mode (close apps) | ❌ |

---

## 4.3 — Project intelligence ❌ NOT STARTED

| Feature | Status |
|---------|--------|
| Auto-scan dev folders | ❌ |
| “Open my React project” without alias | ❌ (alias approximates) |

---

## 4.4 — System actions ✅

**Files:** `parseSystemActionCommand.ts`, `systemActions.ts`

| Command | Status |
|---------|--------|
| Lock PC | ✅ |
| Open Settings / Control Panel | ✅ |
| Bluetooth / Network / Wi-Fi settings | ✅ |
| Task Manager | ✅ |

---

## 4.5 — Intelligent search + suggestions 🟢 MOSTLY COMPLETE

**Files:** `parseSmartSearchCommand.ts`, `intelligentSearch.ts`, `itemResolve.ts`, `disambiguation.ts`

| Feature | Status |
|---------|--------|
| Ambiguity dialog | ✅ |
| Fuzzy filename match | ✅ |
| `file_index` SQLite + watcher | ✅ `fileIndex.ts`, `fileIndexWatcher.ts` |
| Windows Search integration | ✅ P5.2 |
| Time-based search (“3 months ago”) | ✅ `timeRange.ts` |
| “Last downloaded file” | ✅ |
| P8 temporal (“yesterday’s PDF”) | ✅ |
| Hinglish temporal phrases | ✅ |

---

## 4.6 — NLU + session memory ✅

**Spec:** `ripple/PHASE_4.6_COMPLETE.md`

### Pipeline (actual)

```
Voice → Whisper
     → preprocessForNlu() — normalize, Hinglish, Hindi, Urdu, Tamil, Sinhala
     → parseCompoundIntent (and / aur / then)
     → parseNativeCommandStrict
     → parseNluFallback (referential, casual, smart search)
     → parseByIntentClassifier
     → [miss] POST /commands/desktop-intent (LLM JSON)
     → execute locally
     → update memory + history + auto-alias
```

### Modules

| Module | File | Status |
|--------|------|--------|
| Unified preprocess | `voice/nlu/preprocess.ts` | ✅ |
| Hinglish normalize | `voice/i18n/hinglishNormalize.ts` | ✅ |
| Hindi / Urdu / Tamil / Sinhala | `hindiNormalize.ts`, `urduNormalize.ts`, … | ✅ |
| Script detection | `scriptDetect.ts` | ✅ |
| Referential recall | `referentialParse.ts` | ✅ “open it again” |
| Compound commands | `compoundParse.ts` | ✅ |
| Intent classifier | `intentClassifier.ts` | ✅ |
| LLM intent fallback | `llmIntent.ts`, backend `desktopIntent.service.ts` | ✅ |
| Desktop intent guard | `desktopIntentGuard.ts` | ✅ |
| Session memory | `storage/sessionMemory.ts` | ✅ |
| Desktop history | `desktopHistory.ts` | ✅ |
| Last command state | `lastCommandState.ts` | ✅ |
| Referential WhatsApp | `buildReferentialWhatsApp.ts` | ✅ |
| Disambiguation | `desktop/disambiguation.ts` | ✅ |

### Example phrases that work

| Say | Result |
|-----|--------|
| `Bhai mera resume kholo` | Hinglish → search or LLM |
| `Open it again` | recall:auto |
| `Downloads kholo aur latest PDF open karo` | compound 2 steps |
| `Send her the file` | referential WhatsApp |
| `Message Noor hello` | last_contact + send |

---

## 4.7 — Multilingual + spoken responses 🟢 MOSTLY COMPLETE

**Files:** `voice/i18n/*`, `spokenResponses.ts`, tests `phase4.7-i18n.spec.ts`, `phase4-slang-matrix.spec.ts`

| Feature | Status |
|---------|--------|
| Hindi Devanagari patterns | ✅ |
| Urdu Arabic + Roman Urdu | ✅ |
| Tamil / Sinhala basic verbs | ✅ |
| Hinglish slang matrix | ✅ |
| Whisper auto language (when `WHISPER_LANGUAGE` unset) | ✅ |
| Spoken response localization | ✅ partial |

---

## P4.5 — Safety & confirmation ✅

**Files:** `safety/executionGuard.ts`, `executionSimulator.ts`, `permissionEngine.ts`, `permissionGate.ts`

| Feature | Status |
|---------|--------|
| Risk levels per tool/action | ✅ |
| Confirm destructive ops (delete, move across folders) | ✅ |
| Permission engine (clipboard, messaging, …) | ✅ |
| Policy gate before executor | ✅ |

---

## P4.7 — Undo / rollback ✅

**Files:** `safety/undoStack.ts`, `undoRunner.ts`, `parseUndoCommand.ts`, `undoTrash.ts`

| Feature | Status |
|---------|--------|
| Voice undo (“Undo”, “Wapas karo”) | ✅ |
| Undo rename / move / delete / create | ✅ |
| Trash backup before delete | ✅ |
| Workflow rollback on step failure | ✅ `workflowRunner.ts` |

---

## P8 / P8b — Memory layers (shipped with Phase 4 search/memory)

Documented in detail because they complete the “open that file again” story.

### P8a — Last opened & temporal recall ✅

**Docs:** `P8-LAST-OPENED.md`, `P8-TEMPORAL-PDF.md`

| Capability | Implementation |
|------------|----------------|
| Last opened pdf/image/video/folder/file | `p8RecallResolver.ts`, `activity_log` |
| “Opened yesterday” / N months ago | `timeRange.ts`, focus watcher |
| Compound recall | `compoundParse.ts` |
| Explorer/Photos burst polling | `focusContext.ts` P8 watcher |

### P8b — Semantic memory ✅

**Docs:** `P8-SEMANTIC.md`

| Capability | Implementation |
|------------|----------------|
| “PDF I discussed with Ahmed” | `parseSemanticOpen.ts`, `semanticRetriever.ts` |
| Life events (“before my Goa trip”) | `lifeEvents.ts` |
| Cross-app ingest IPC | `memory:ingest-cross-app` |
| BM25-lite ranking | `semanticVectorRank.ts` |

**Future:** sqlite-vec embeddings (optional upgrade).

---

## 4.9 — Reliability & QA 🟡 PARTIAL

| Item | Status |
|------|--------|
| Manual QA checklist | ✅ `PHASE_3.5_QA.md` |
| Structured telemetry | ✅ Phase 6 |
| CI matrix gate 99.8% | ✅ Phase 6 |
| Formal 95% voice sign-off | ❌ |
| Installer smoke / extension wizard | ❌ |

---

# Phase 5 — Search & Retriever ✅ COMPLETE

**Spec:** `FINAL_IMPLEMENTATION_PLAN.md` § P5  
**Tests:** `phase-p5-retriever.spec.ts`, `phase-p8-semantic.spec.ts`

## P5.1 — Retriever orchestration ✅

**Files:** `retriever/retriever.ts`, `retrieveForPlan.ts`

All file/app opens go through a canonical chain — planner does not invent paths.

## P5.2 — File search order ✅

```text
1. knowledge_graph      ← instant if learned (P5.5)
2. alias registry       ← user-taught paths
3. Windows Search       ← OS index (primary)
4. file_index (SQLite)  ← cache + time_filter
5. disk walk            ← last resort
```

| File | Role |
|------|------|
| `windowsSearch.ts` | Shell / OS search |
| `cacheRetrieverHits.ts` | Cache OS hits into index |
| `fileIndexWatcher.ts` | Watch Downloads/Documents/Desktop |
| `searchRoots.ts` | Configured search roots |
| `appStateResolver.ts` | Focus running app vs relaunch |

## P5.3 — Time-based retrieval ✅

**File:** `retriever/timeRange.ts`

| Slot | Example voice |
|------|----------------|
| `yesterday`, `last_week`, `3_months_ago` | “PDF I edited 3 months ago” |

---

# Phase 5.5 — Knowledge graph & workflows ✅ COMPLETE

**Files:** `storage/knowledgeGraph.ts`, `workflowGraph.ts`, `retriever/graphLookup.ts`  
**Tests:** `knowledgeGraph.spec.ts`, `workflowGraph.spec.ts`, `phase-p55-workflow.spec.ts`

## SQLite tables (`ripple.db`)

| Table | Purpose |
|-------|---------|
| `knowledge_entity` | project, file, contact, app, app_role, workspace |
| `workflow_graph` | Named multi-app sequences (“work mode”) |

## Entity types

| Type | Example | Resolves to |
|------|---------|-------------|
| `project` | my project | Folder path |
| `file` | my resume | PDF path |
| `contact` | noor | WhatsApp contact |
| `app` | vscode | Launch string |
| `app_role` | my design app | Figma (learned) |
| `workflow` | work mode | VS Code + Chrome + … |

## Features

| Feature | Status |
|---------|--------|
| Graph fast path for open commands | ✅ `parseGraphOpenCommand.ts` |
| App role learning (browser, editor, design) | ✅ `appRoles.ts` |
| Decay scoring (stale entities deprioritized) | ✅ |
| Workflow versioning + run_count | ✅ |
| Capability cache (instant repeat hits) | ✅ |

---

# Phase 6 — Telemetry & Observability ✅ COMPLETE

**Spec:** `FINAL_IMPLEMENTATION_PLAN.md` § P6  
**Tests:** `npm run test:p6`, `npm run test:ci:gate` (99.8% on 418-case matrix)

## P6.1 — Event telemetry ✅

**File:** `electron/telemetry/commandTelemetry.ts`

Per-command record:

```typescript
{
  command_raw, nlu, parse_path, tool, confidence,
  candidate_count, resolve_action, permission_level,
  safety_confirmed, rate_limited, success, latency_ms, error_code
}
```

| Integration | Status |
|-------------|--------|
| SQLite `command_telemetry` | ✅ `rippleDb.ts` |
| All orchestrator paths log events | ✅ `commandOrchestrator.ts` |
| Retriever miss logging | ✅ `retrieverTelemetry.ts` |
| Safety / permission events | ✅ |

## P6.2 — Observability dashboard ✅

**Files:** `observabilityDashboard.ts`, `src/pages/Telemetry.tsx`

| Surface | Status |
|---------|--------|
| IPC `telemetry:summary` | ✅ |
| IPC `telemetry:export` (CSV) | ✅ |
| IPC `telemetry:gate` | ✅ |
| P8.5 planner section (later) | ✅ added with P8.5 |
| Top failures, planner mix, success % | ✅ |
| Top workflows / apps from graph | ✅ |

## P6.3 — CI pipeline ✅

| Script | Purpose |
|--------|---------|
| `npm run test:ci:gate` | Fail if matrix &lt; 88% pass |
| `npm run test:ci` | Full pre-ship suite |
| `npm run test:e2e:local` | Production regression cases |
| `npm run test:e2e:live` | Live Whisper (optional) |
| `npm run test:phase4` | NLU test suite |

**Gate result:** 99.8% (417/418) documented in implementation plan.

## P6.4 — Release checklist 🟡

| Item | Status |
|------|--------|
| GPT planner path tested | ✅ |
| Permission block list reviewed | ✅ |
| Undo for rename/move/delete | ✅ |
| Dashboard + CI gate | ✅ |
| Installer smoke test | ❌ |
| Formal 4.9 acceptance demo (14 scenarios) | ❌ |
| Extension onboarding wizard | ❌ |

---

# Local storage summary (Phases 3–6)

**Path:** `%LOCALAPPDATA%\Ripple\`

| Asset | Purpose | Phase |
|-------|---------|-------|
| `aliases.json` | User shortcuts | 4.3A |
| `workflows.json` | User routines | 4.3C |
| `workspaces.json` | URL workspaces | 4.3B |
| `contacts.json` | WhatsApp name overrides | 3.5 |
| `ripple.db` | SQLite intelligence | 4.5–6 |
| ↳ `memory` | last_file, last_contact, … | 4.6 |
| ↳ `desktop_history` | Last 50 desktop commands | 4.6 |
| ↳ `file_index` | Search cache | 4.5 / P5 |
| ↳ `activity_log` | Opened files, contacts | P8 |
| ↳ `semantic_index` | BM25 tokens/snippets | P8b |
| ↳ `life_events` | User-tagged milestones | P8b |
| ↳ `knowledge_entity` | Graph | P5.5 |
| ↳ `workflow_graph` | Learned workflows | P5.5 |
| ↳ `command_telemetry` | Per-command metrics | P6 |
| ↳ `planner_shadow` | P8.5 shadow logs | P8.5 |

---

# Test commands (Phases 3–6)

```powershell
cd ripple-desktop

# Phase 4 NLU + i18n
npm run test:phase4
npm run test:p4

# Phase 5 retriever + graph
npm run test:ci    # includes P5, P5.5, P8 semantic, safety, undo

# Phase 6 telemetry
npm run test:p6
npm run test:ci:gate

# Integration / disk
npm run test:integration
npm run test:e2e:local

# P8 semantic seed
npm run seed:p8b
```

---

# Sign-off matrix (Phases 3–6)

| Phase | Code | User-facing |
|-------|------|-------------|
| **3** — Desktop shell | ✅ Complete | ✅ |
| **3.5** — Web automation | ✅ Complete (no Slack) | ✅ |
| **4.1** — Apps | ✅ Complete | ✅ |
| **4.2** — Files & ops | ✅ Core complete | ✅ |
| **4.3A/B/C** — Aliases, workspaces, workflows | ✅ Complete | ✅ |
| **4.3** — Project scan | ❌ Not started | ❌ |
| **4.4** — System actions | ✅ Complete | ✅ |
| **4.5** — Smart search | ✅ Mostly complete | ✅ |
| **4.6** — NLU + memory | ✅ Complete | ✅ |
| **4.7** — Multilingual | 🟢 Mostly complete | 🟢 |
| **4.8** — Local workflow engine | ✅ Complete | ✅ |
| **4.9** — QA sign-off | 🟡 Partial | 🟡 |
| **P4.5** — Safety | ✅ Complete | ✅ |
| **P4.7** — Undo | ✅ Complete | ✅ |
| **P8 / P8b** — Memory | ✅ Shipped | 🟡 Voice QA ongoing |
| **5** — Retriever | ✅ Complete | ✅ |
| **5.5** — Knowledge graph | ✅ Complete | ✅ |
| **6** — Telemetry & CI | ✅ Complete | ✅ Dashboard live |

---

# What is NOT in Phases 3–6 (deferred to later phases)

| Item | Target phase |
|------|----------------|
| Project auto-discovery | 4.3 (unfinished) |
| Duplicate file command | 4.2 |
| Stop work mode (close workflow apps) | 4.3C |
| Formal 95% QA / installer wizard | 4.9 / 6.4 |
| sqlite-vec embeddings | P8b future |
| Rust native sidecar | **Phase 7** → ✅ done |
| Universal intent planner | **P8.5** → 🚀 in progress |
| Full agent observe/replan loop | **P9** |
| OCR-guided UI click | P7 polish / P10 |

---

# Related documents

| Document | Content |
|----------|---------|
| [PHASE-7-AND-P85-COMPLETED.md](./PHASE-7-AND-P85-COMPLETED.md) | P7 + P8.5 status |
| [P7-FEATURES.md](./P7-FEATURES.md) | Native RPC + voice commands |
| [P8-SEMANTIC.md](./P8-SEMANTIC.md) | Semantic memory detail |
| [P8-LAST-OPENED.md](./P8-LAST-OPENED.md) | Last-opened recall |
| [P8.5-UNIVERSAL-PLANNER.md](./P8.5-UNIVERSAL-PLANNER.md) | Planner status |
| `ripple/PHASE3_END_TO_END.md` | Phase 3 API + socket reference |
| `ripple/PHASE_3.5_COMPLETE.md` | Web app automation detail |
| `ripple/COMPLETED_STATUS.md` | Earlier snapshot (some rows superseded by this doc) |
| `ripple/FINAL_IMPLEMENTATION_PLAN.md` | Master implementation plan P4–P8 |

---

**Bottom line:** Phases **3**, **3.5**, **5**, **5.5**, and **6** are **complete in code**. Phase **4** is **~90% complete** — core desktop control, NLU, memory, safety, and undo work end-to-end; project intelligence (4.3) and formal QA sign-off (4.9) remain. **P8/P8b** memory shipped as part of the Phase 4 search/memory track. **Phase 7** and **P8.5** are documented separately.
