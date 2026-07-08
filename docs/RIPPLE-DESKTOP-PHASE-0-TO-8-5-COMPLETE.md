# Ripple Desktop — Complete Engineering Documentation (Phase 0 → Phase 8.5)

**Generated:** July 2026  
**Repository:** `ripple-desktop/` (+ `ripple-backend/` for Phases 1–2)  
**Method:** Verified against source code, tests, configs, and existing docs. Items not verified in code are marked explicitly.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Complete System Architecture](#2-complete-system-architecture)
3. [Phase-by-Phase Implementation History](#3-phase-by-phase-implementation-history)
4. [Tool System](#4-tool-system)
5. [Native Layer](#5-native-layer)
6. [Folder Map](#6-folder-map)
7. [Tests](#7-tests)
8. [Environment Configuration](#8-environment-configuration)
9. [Current Completion Status](#9-current-completion-status)
10. [Remaining Work](#10-remaining-work)
11. [Final Architecture Vision](#11-final-architecture-vision)

---

# 1. Project Overview

## What Ripple Desktop Is

Ripple Desktop is a **Windows-first Electron voice assistant** that listens via a global hotkey, transcribes speech through a remote Whisper backend, plans multi-step actions from natural language, and executes them on the local machine — desktop apps, filesystem, clipboard, browser tabs, and Chrome-extension–bridged web apps (WhatsApp, Gmail, Instagram, etc.).

## Product Vision

Turn spoken intent into reliable computer control: *"Open Notepad, type hello, select all and copy"* or *"Message Saaliq saying I'll be there in 10 minutes"* — without the user manually clicking through each step.

## Core Problem It Solves

- **Voice → action gap:** STT alone does not control apps; Ripple closes the loop with planning, validation, and OS-level execution.
- **Context awareness:** Focus, foreground window, clipboard, and browser surface inform what "type here" or "send to her" means.
- **Multilingual input:** Hindi, Hinglish, Urdu, and English voice commands with NLU normalization.

## Current Capabilities (verified in code)

| Domain | Examples | Execution path |
|--------|----------|----------------|
| **Desktop typing & keys** | type, select all, copy/cut/paste, undo, caret navigation | P7 `send_keys` / `run_input_sequence` via `ripple-native.exe` or PowerShell fallback |
| **Mouse** | move pointer, click, scroll, drag | Native RPC `mouse_*` |
| **App launch & focus** | open Notepad, Paint, Chrome, VS Code | `desktop.launch_app`, `launchNativeApp()` |
| **Paint drawing** | draw circle, square, multi-shape compounds | `desktop.paint_op` + mouse drag |
| **Filesystem** | create, rename, move, delete, open files/folders | `filesystem.*` tools |
| **Clipboard** | read/write OS clipboard | `system.clipboard.*` + `retryDesktopKeys` verification |
| **Save dialogs** | save as in Downloads | `desktop.save_file`, `submitSaveDialog()` |
| **Web apps** | WhatsApp message, Gmail compose, IG DM | Chrome extension DOM + CDP + legacy payload routers |
| **Search & recall** | find files, semantic search, last-opened | `memory.search`, retriever chain, SQLite graphs |
| **Compound commands** | open app + type + copy + save | L0 compound planner, Planner v2 clause routing |

## How the Layers Combine

```
User speaks (Ctrl+Space)
    → Mic capture (renderer)
    → Socket.IO voice chunks → Backend Whisper STT
    → Transcript pipeline (normalize, NLU, intent)
    → Command orchestrator (P8.5 fast path)
    → Planner (L0 / compound / v2 / GPT fallback)
    → Plan validator + confidence gate
    → Tool executor (default) OR legacy action payload
    → Electron bridge (win32Bridge, insertText, launchApp)
    → ripple-native.exe (Rust) OR PowerShell SendInput fallback
    → Windows OS APIs
```

**Key files:** `electron/main/index.ts`, `electron/services/commandOrchestrator.ts`, `electron/agent/planner/`, `electron/native/win32Bridge.ts`, `ripple-native/src/`.

---

# 2. Complete System Architecture

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  RENDERER (React 19)                                            │
│  src/pages/Overlay.tsx, useVoiceCapture.ts                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ contextBridge (electron/preload/index.ts)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  ELECTRON MAIN                                                  │
│  electron/main/index.ts — IPC, native host boot, socket         │
├─────────────────────────────────────────────────────────────────┤
│  Voice: transcriptPipeline.ts → commandOrchestrator.ts          │
│  Planning: plannerPipeline.ts → planValidator.ts                │
│  Execution: toolExecutor.ts | runCommandActions (legacy)        │
│  World: worldModel.ts                                           │
│  Storage: SQLite (activity, shadow, graphs, semantic index)     │
└───────────┬─────────────────────────────┬───────────────────────┘
            │ Socket.IO                     │ Named pipe JSON-RPC
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────────────────┐
│  ripple-backend       │       │  ripple-native.exe (Rust)         │
│  Whisper STT, GPT,    │       │  send_input, mouse, window, UIA,  │
│  command API          │       │  OCR, hotkeys, foreground events  │
└───────────────────────┘       └───────────────────────────────────┘
                                            │
                                            ▼
                                    Windows OS APIs
```

## Layer Reference

| Layer | Responsibility | Primary Files |
|-------|----------------|---------------|
| **Renderer UI** | Login, overlay pill, history, telemetry dashboard | `src/pages/`, `src/stores/`, `src/hooks/` |
| **Preload bridge** | Expose `window.ripple` IPC API | `electron/preload/index.ts` |
| **Main process** | App lifecycle, IPC handlers, native host init | `electron/main/index.ts` |
| **Socket client** | Backend voice streaming, command execute | `electron/socket/rippleSocket.ts` |
| **Transcript pipeline** | Post-STT normalization and NLU entry | `electron/automation/voice/transcriptPipeline.ts` |
| **Command orchestrator** | Route to P8.5, adapters, undo, legacy paths | `electron/services/commandOrchestrator.ts` |
| **Intent normalizer** | Clean utterance before planning | `electron/agent/intentNormalizer.ts` |
| **World model** | Foreground, UIA, clipboard, mouse, capabilities snapshot | `electron/agent/worldModel.ts` |
| **Planner system** | L0, compound, v2, cache, grounded, GPT | `electron/agent/planner/` |
| **Plan validator** | Schema, permissions, clipboard sequencing | `electron/agent/planner/planValidator.ts` |
| **Confidence engine** | Execute vs clarify thresholds | `electron/agent/planner/confidenceEngine.ts` |
| **Tool executor** | Step loop, safety, recovery, memory record | `electron/agent/planner/toolExecutor.ts` |
| **Tool registry** | Register and dispatch tools | `electron/agent/planner/toolRegistry.ts` |
| **Legacy bridge** | `_desktopPayload` → `runCommandActions` | `executionPlanToPayload.ts`, `actionRunner.ts` |
| **Native bridge** | RPC to Rust sidecar + PS fallback | `electron/native/win32Bridge.ts`, `nativeClient.ts` |
| **Rust sidecar** | Low-latency OS automation | `ripple-native/src/` |
| **Chrome extension** | DOM automation for web apps | `ripple-chrome-extension/` |

## Data Flow (voice command)

1. **Capture:** `useVoiceCapture` records audio → `voice:chunk` / `voice:end` IPC.
2. **STT:** `rippleSocket` streams to backend → transcript returned.
3. **NLU:** `transcriptPipeline` → `normalizeTranscript` → `nlu/preprocess` → orchestrator.
4. **Plan:** `tryP85FastPath` → `buildWorldModel` → `runPlannerPipelineAsync`.
5. **Validate:** `validatePlan` → `passesConfidenceGate` → `buildExecutorPayload`.
6. **Execute:** `runValidatedPlanExecution` → `executePlan` (tools) or legacy payload.
7. **Observe:** `executionObserver`, clipboard probes, action acks to backend.

## Communication Patterns

| Path | Protocol | Auth |
|------|----------|------|
| Renderer ↔ Main | Electron IPC (`ipcMain` / `contextBridge`) | In-process |
| Main ↔ Backend | Socket.IO + REST (`VITE_API_URL`) | JWT from keytar |
| Main ↔ Native | Named pipe, 4-byte LE framed JSON-RPC | Session token file |
| Main ↔ Chrome ext | Native Messaging port 39731 | Framed JSON |
| OS tests ↔ Main | File bridge (`os-test-in.json` / `os-test-out.json`) | `RIPPLE_OS_TEST=1` |

---

# 3. Phase-by-Phase Implementation History

> **Note on phase numbering:** Ripple uses project-specific phase labels (3, 3.5, 4, 7, 8.5). The generation spec template uses different labels for Phases 2–6; this document follows **actual Ripple phase names** from `docs/` and code.

---

## Phase 0 — Project Scaffold

### Purpose
Establish Electron + React + Vite foundation and monorepo layout for the desktop client.

### Features Added
- electron-vite build (`electron.vite.config.ts`)
- React renderer entry (`index.html` → `src/main.tsx`)
- Main/preload split (`electron/main/`, `electron/preload/`)
- electron-builder packaging scaffold (`electron-builder.yml`)
- TypeScript configs (`tsconfig*.json`)

### Important Files
- `package.json`, `electron.vite.config.ts`, `index.html`
- `electron/main/index.ts`, `electron/preload/index.ts`
- `src/App.tsx`, `src/pages/`

### Current Status
**✅ Complete** — foundation stable.

---

## Phase 1–2 — Backend (ripple-backend)

### Purpose
Auth, sessions, command engine, Whisper integration. Prerequisite for Phase 3 desktop shell.

### Features Added
- Signup/login, JWT refresh
- Command execute API, history, action acks
- Intent types: generation, edit, navigation, typing, workflow
- Socket.IO voice streaming → Whisper

### Important Files
- `ripple-backend/` (separate repo folder)
- Referenced in desktop: `electron/socket/rippleSocket.ts`, `electron/services/api.ts`

### Current Status
**✅ Complete** (per `ripple-backend/PHASE1_FINAL.md`, `PHASE2_FINAL.md`).  
*Historical phase information based on repository documentation — desktop repo contains client integration only.*

---

## Phase 3 — Desktop Voice Assistant Shell

### Purpose
Electron app that connects to backend and executes `actions[]` locally.

### Features Added
| Feature | Files |
|---------|-------|
| Login, JWT in keytar | `electron/auth/` |
| System tray, global hotkey Ctrl+Space | `electron/tray/`, `electron/shortcuts/` |
| Voice overlay pill | `electron/windows/overlay.ts`, `src/pages/Overlay.tsx` |
| Focus capture/restore | `electron/focus/focusContext.ts` |
| Action runner (INSERT_TEXT, OPEN_APP, etc.) | `electron/automation/actionRunner.ts` |
| Command history UI | `src/pages/History.tsx` |
| REST fallback when socket offline | `commandOrchestrator.ts`, `api.ts` |

### Current Status
**✅ Complete** — see `docs/PHASE-3-THROUGH-6-COMPLETED.md`.

---

## Phase 3.5 — Web App Automation

### Purpose
Real workflows in WhatsApp, Gmail, Instagram, LinkedIn, Notion, YouTube via Chrome extension + CDP.

### Features Added
- Focus detection per app surface (`focusContext.ts`)
- Native Messaging bridge (port 39731)
- Per-app voice overrides (`*VoiceOverride.ts`)
- Chrome extension DOM automation (`ripple-chrome-extension/`)
- CDP dedicated Chrome profile (`RIPPLE_CDP_*`)
- Workflow expander (`workflow/actionExpander.ts`)

### Important Files
- `electron/automation/adapters/`
- `electron/bridge/`, `native-host/`
- `ripple-chrome-extension/`
- `WHATSAPP_SETUP.md`

### Current Status
**✅ Complete** for scoped apps. Slack explicitly deferred.

---

## Phase 4 — Desktop Intelligence (NLU, Apps, Safety)

### Purpose
Local-first desktop command understanding without always calling GPT.

### Features Added
| Area | Module | Status |
|------|--------|--------|
| Desktop NLU | `parseDesktopInput.ts`, `compoundParse.ts` | ✅ |
| App resolution | `resolveNativeApp`, aliases | ✅ |
| Multilingual | `voice/i18n/`, `nlu/preprocess.ts` | ✅ |
| Safety / permissions | `automation/safety/` | ✅ |
| Undo | `undoStack.ts` | ✅ |
| Disk integration | `desktop/__tests__/disk.integration.spec.ts` | ✅ |

### Important Files
- `electron/agent/parseDesktopInput.ts`
- `electron/automation/voice/nlu/` (28 spec files)
- `electron/automation/safety/permissionEngine.ts`

### Current Status
**✅ Core complete.** Ongoing NLU fixture expansion in P8.5 shadow parity.

---

## Phase 5 / 5.5 — Retriever & Knowledge Graph

### Purpose
Intelligent file/contact search and workflow memory.

### Features Added
- Windows Search integration
- Semantic embeddings (sqlite-vec)
- Knowledge graph, workflow graph
- `memory.search` tool
- Temporal / last-opened tracking (P8/P8b)

### Important Files
- `electron/automation/retriever/`
- `electron/storage/` (graphs, semantic index)
- `docs/P8-SEMANTIC.md`, `P8-LAST-OPENED.md`, `P8-TEMPORAL-PDF.md`

### Current Status
**✅ Shipped.** Full entity resolver in planner still partial (app phrase only).

---

## Phase 6 — Telemetry & Observability

### Purpose
Command quality metrics, CI gate, developer dashboard.

### Features Added
- Activity log persistence
- Observability dashboard (`src/pages/Telemetry.tsx`)
- CI gate spec (`electron/telemetry/__tests__/ci-gate.spec.ts`)
- Planner shadow metrics (`planMetricsDashboard.ts`)

### Current Status
**✅ Complete** — `npm run test:p6`, `test:ci:gate`.

---

## Phase 7 — Native Rust Layer (Hands & Eyes)

### Purpose
Low-latency, reliable Windows automation via sidecar process.

### Features Added (P7a–P7g)

| Sub-phase | Feature | Rust module |
|-----------|---------|-------------|
| P7a | Sidecar spawn, session token, pipe auth | `main.rs`, `session.rs`, `ipc/` |
| P7b | Global hotkeys | `hotkeys.rs` |
| P7c | Foreground, focus, close, list windows | `foreground.rs`, `window_ops.rs`, `window_list.rs` |
| P7d | SendInput keyboard | `send_input.rs` |
| P7e | UI Automation | `uia.rs` |
| P7f | OCR (WinRT) | `ocr.rs` |
| P7g | Mouse click/scroll/drag/move | `mouse.rs` |

### Electron Bridge
- `electron/native/nativeHost.ts` — spawn, watchdog, auth
- `electron/native/win32Bridge.ts` — primary API + PowerShell fallback
- `electron/agent/retryTyping.ts` — focus barrier, clipboard verification
- `electron/agent/focusBarrier.ts`, `editorFocus.ts` — Notepad/classic editor hardening

### Current Status
**✅ Core complete.** Deferred: OCR-guided click, elevation into admin windows, napi-rs in-process addon.  
See `docs/P7-FEATURES.md`, `docs/PHASE-7-AND-P85-COMPLETED.md`.

---

## Phase 8 / 8b — Semantic Memory

### Purpose
Longer-horizon recall: last-opened files, temporal queries, PDF context.

### Status
**✅ Shipped alongside Phase 4–6.** Documented in `docs/P8-*.md`. Not a separate runtime layer — integrated into retriever and `memory.search`.

---

## Phase 8.5 — Universal Intent Planner

### Purpose
Convert natural language → validated, ordered tool calls. P7 executes; P8.5 never calls Win32 directly.

### Features Added

| Module | File | Status |
|--------|------|--------|
| Tool registry + manifest | `toolRegistry.ts`, `toolManifest.json` | ✅ |
| L0 planner | `l0Planner.ts` | ✅ |
| L0 compound | `l0CompoundPlanner.ts` | ✅ |
| Planner v2 (L2–L5) | `v2/plannerV2.ts`, `clauseClassifier.ts` | ✅ v2.0–v2.4 |
| Pipeline sync/async | `plannerPipeline.ts` | ✅ |
| Plan validator | `planValidator.ts` | ✅ |
| Confidence engine | `confidenceEngine.ts` | ✅ |
| Clarification engine | `clarificationEngine.ts` | ✅ |
| Recovery engine | `recoveryEngine.ts` | ✅ |
| Tool executor (default on) | `toolExecutor.ts`, `toolExecutorBridge.ts` | ✅ |
| GPT / grounded fallback | `gptPlannerBridge.ts`, `groundedPlannerBridge.ts` | ✅ |
| Shadow + parity | `planLogger.ts`, `routerParity.ts` | ✅ |
| Capability snapshot | `capabilityService.ts` | 🟡 partial |
| Planner memory | `plannerMemory.ts` | ✅ in-memory |
| Entity resolver | `entityResolver.ts` | 🟡 launch-app only |

### P8.5 Sub-phases (internal)

| Phase | Weight | Status |
|-------|--------|--------|
| Phase 0 Scaffold | 10% | ✅ |
| Phase 1 Desktop tools | 15% | ✅ |
| Phase 2 Safety + pipeline | 15% | ✅ |
| Phase 3 Shadow parity | 10% | ✅ |
| Phase 4 Delete routers | 15% | 🟡 ~7% |
| Phase 5 Tool catalog | 20% | 🟡 ~12% |
| Production metadata §15 | 15% | 🔴 ~2% |

**Overall P8.5:** ~72% complete per `docs/P8.5-REMAINING.md`.

---

## Desktop Control Proof Matrix (E1–E7)

User-facing "Phase 1" desktop control validation (distinct from Ripple phase numbers):

| Executor | Domain | OS test IDs | Status |
|----------|--------|-------------|--------|
| E1–E3 | App launch, focus, Notepad typing | P1-01–P1-13 | ✅ Phase 1 OS matrix |
| E4 | Paint draw compounds | P1-*, E4-01–E4-13, P1-E01–E09 | ✅ core shapes; extended erase/label partial |
| E5 | Multi-shape / mouse | P1-07–P1-11 | ✅ |
| E6 | Save dialog / filesystem | P1-E10, E7-07–E7-14 | 🟡 mixed |
| E7 | Clipboard read/write/cut | E7-01, E7-02, E7-R01, E7-R02 | ✅ verified with `OS_TEST_LOCK_WINDOW=notepad` |

Test runner: `scripts/ui-test-p85-os.mjs`, `scripts/ui-test-e4-e7-matrix.mjs`.

---

## Phase 9 — Agent Brain (Scaffold)

### Purpose
Observe → retry → replan loop for long workflows.

### Status
**🔜 Scaffold only** — `executionObserver.ts`, `agentOrchestrator.ts`, `docs/P9-AGENT-BRAIN-ARCHITECTURE.md`. Not production path.

---

## Phase 1.5 — Capability System (Planned, Not Started)

### Purpose
Formal capability modules per app (Paint, Notepad) → platform adapter → OS implementation.

### Status
**🔴 Not implemented.** `capabilityService.ts` provides snapshot only; no `electron/capabilities/` folder yet. Agreed as next engineering priority after this documentation pass.

---

# 4. Tool System

## Architecture

```
toolDefinitions.ts (schemas)
        ↓
toolManifest.json (generated catalog v1.3.0)
        ↓
toolRegistry.ts — registerTool(), executeToolForExecutor()
        ↓
toolExecutor.ts — executePlan() step loop
        ↓
tools/*.ts — per-domain execute handlers
```

Registration entry: `toolExecutorBridge.ts` → `ensureP85ToolsRegistered()`.

## Registered Tools (26 executable)

### Desktop (12)
| Tool | Handler | Notes |
|------|---------|-------|
| `desktop.type_text` | `desktopTools.ts` → `runInsertText` | Unicode + classic editor paths |
| `desktop.press_keys` | same | Sequences, chords |
| `desktop.copy` / `paste` / `select_all` | same | Clipboard ops via `retryDesktopKeys` |
| `desktop.mouse_click` / `move` / `scroll` / `drag` | same → `win32Bridge` | Native RPC |
| `desktop.launch_app` | `launchNativeApp` | Entity resolver expansion |
| `desktop.focus_window` / `close_window` | window manager | HWND or app name |
| `desktop.save_file` | `submitSaveDialog` | Save-as flow |
| `desktop.paint_op` | `insertText.ts` paint helpers | **Not in manifest**; registered |

### Filesystem (6)
`filesystem.create`, `create_folder`, `delete`, `rename`, `move`, `open`

### System (2)
`system.clipboard.read`, `system.clipboard.write`

### Browser (2)
`browser.open_workspace`, `browser.search_workspace`

### Memory (1)
`memory.search` → retriever + smart open

## Manifest-Only (no `execute()` registered)
- `browser.search`
- `browser.whatsapp.send`
- `browser.gmail.compose`

These still route through **legacy payload routers** in `commandOrchestrator.ts`.

## Plan → Execution Paths

| Path | When | Entry |
|------|------|-------|
| **Tool executor** (default) | Validated `ExecutionPlan`, `RIPPLE_P85_TOOL_EXECUTOR` on | `runPlanViaToolExecutor` |
| **Legacy payload** | Bridged `_desktopPayload`, communication tools | `runCommandActions` |
| **Legacy routers** | Kill switch off, env force flags | `legacyRouterGate.ts` |

## Validation Rules (`planValidator.ts`)

- Unknown tool → `unknown_tool:{tool}`
- Missing required args per `argsSchema`
- `desktop.press_keys` needs `keys` or `sequence`
- `desktop.paste` blocked if clipboard empty (no prior `system.clipboard.write`)
- Permission engine blocks destructive ops
- `unbridged_tool` if not in registry and no bridge args

---

# 5. Native Layer

## Rust Crate: `ripple-native/`

| Module | RPC methods | Status |
|--------|-------------|--------|
| `send_input.rs` | `send_keys`, `run_input_sequence` | ✅ |
| `mouse.rs` | `mouse_click`, `mouse_scroll`, `mouse_drag`, `mouse_move`, `get_cursor_position` | ✅ |
| `window_ops.rs` | `focus_window`, `close_window`, `get_window_rect` | ✅ |
| `window_list.rs` | `list_windows` | ✅ |
| `uia.rs` | `get_focused_a11y` | ✅ |
| `ocr.rs` | `screenshot_ocr` | ✅ (runtime-gated) |
| `foreground.rs` | `get_foreground` + WinEvent push | ✅ |
| `hotkeys.rs` | Global voice/cancel hotkeys | ✅ |
| `ipc/pipe_server.rs` | JSON-RPC dispatcher | ✅ |

Build: `npm run native:build` → `scripts/run-cargo.mjs` → copy to `resources/native/win32/`.

## Electron Bridge

| File | Role |
|------|------|
| `nativeSpawn.ts` | Spawn exe, read `%LOCALAPPDATA%\Ripple\ripple-native.session` |
| `nativeClient.ts` | `callNativeRpc()`, push event stream |
| `nativePipeFraming.ts` | 4-byte LE length + JSON |
| `nativeHost.ts` | Orchestration, watchdog, hotkey bridge |
| `win32Bridge.ts` | **Primary TS API** — RPC first, PowerShell `SendKeys` fallback |

## Keyboard System
- Rust: `SendInput` via `send_input.rs`
- Fallback: embedded PowerShell `SendKeys`
- Sequences: `run_input_sequence` for multi-step chords
- Classic editors: `retryTyping.ts` uses STA PowerShell for Notepad ^a/^c/^x when native path fails

## Mouse System
- Virtual desktop metrics for multi-monitor (`SM_XVIRTUALSCREEN`)
- Elevation guard blocks injection into elevated windows

## Window Management
- Foreground cache + `foreground_changed` events
- `focusWindowByHwnd`, `closeWindowByHwnd` in automation layer
- Program Manager / desktop shell rejected as typing target

## UI Automation
- `get_focused_a11y` returns control name, role, bounds
- Used by `worldModel.ts` and editor focus heuristics

## OCR
- `screenshot_ocr` via Windows.Media.Ocr
- **Not wired into world model** — OCR exists but planner does not consume screen text today

---

# 6. Folder Map

```
ripple-desktop/
├── electron/                    # Main-process backend
│   ├── agent/                   # P8.5 planner, tools, world model, execution helpers
│   │   ├── planner/             # Pipeline, validator, executor, v2/
│   │   │   └── tools/           # desktopTools, filesystemTools, etc.
│   │   └── __tests__/           # 31 P8.5 spec files
│   ├── automation/              # Desktop, voice, browser, adapters, safety
│   │   ├── voice/nlu/           # Compound parse, intent, 28 NLU specs
│   │   ├── desktop/             # launchApp, Paint, save dialogs
│   │   └── adapters/            # WhatsApp, Gmail, IG, etc.
│   ├── auth/                    # keytar token store
│   ├── bridge/                  # Chrome extension bridge
│   ├── config/                  # Env loading
│   ├── focus/                   # Focus context tracking
│   ├── main/                    # Electron bootstrap + IPC
│   ├── native/                  # Rust sidecar client
│   ├── preload/                 # contextBridge API
│   ├── services/                # commandOrchestrator, api
│   ├── socket/                  # Backend WebSocket
│   ├── storage/                 # SQLite, graphs, semantic index
│   ├── telemetry/               # Metrics, CI gate
│   └── windows/                 # mainWindow, overlay, disambiguation
├── src/                         # React renderer
│   ├── pages/                   # Home, Login, Overlay, History, Telemetry
│   ├── hooks/                   # useVoiceCapture, etc.
│   └── stores/                  # Zustand state
├── ripple-native/               # Rust Windows sidecar
├── ripple-chrome-extension/     # Web app DOM automation
├── native-host/                 # Chrome Native Messaging host
├── scripts/                     # OS tests, native build, vitest live
├── docs/                        # Engineering plans (this file included)
└── resources/native/win32/      # Bundled ripple-native.exe
```

---

# 7. Tests

## Summary

| Metric | Count |
|--------|------:|
| Files under `**/__tests__/**` | 118 |
| `*.spec.ts` files | 113 |
| NLU support harness files | 5 |

## By Area

| Area | Path | Spec files |
|------|------|----------:|
| Agent P8.5/P9 | `electron/agent/__tests__` | 31 |
| Voice NLU | `electron/automation/voice/nlu/__tests__` | 28 |
| Voice i18n | `electron/automation/voice/i18n/__tests__` | 4 |
| Voice STT | `electron/automation/voice/__tests__` | 2 |
| Desktop automation | `electron/automation/desktop/__tests__` | 9 |
| Retriever | `electron/automation/retriever/__tests__` | 9 |
| Safety | `electron/automation/safety/__tests__` | 5 |
| Storage | `electron/storage/__tests__` | 10 |
| Telemetry | `electron/telemetry/__tests__` | 3 |
| Native P7 | `electron/native/__tests__` | 2 |
| Other (planner, gmail, workflow, adapters) | various | 10 |

## Test Commands

| Command | What it runs |
|---------|--------------|
| `npm test` / `npm run test:all` | Full vitest suite |
| `npm run test:p85` | P8.5 agent specs + P9 (~350 tests reported in P8.5-REMAINING) |
| `npm run test:phase4` | All voice NLU specs |
| `npm run test:ci` | Large CI bundle |
| `npm run test:ui-os` | `scripts/ui-test-p85-os.mjs` (planner + OS) |
| `npm run test:ui-os-only` | OS automation only |
| `npm run test:ui-os-e7-clipboard` | E7 clipboard subset |
| `npm run test:ui-matrix` | E4–E7 planner matrix via CDP |
| `npm run test:e2e:live` | Live Whisper (needs backend + token) |

## OS Test Bridge

File-based IPC for real OS verification (no CDP):
- Input: `%APPDATA%/ripple-desktop/os-test-in.json`
- Output: `os-test-out.json`
- Bridge: `electron/osTestBridge.ts`
- Env: `RIPPLE_OS_TEST=1`, `OS_TEST_LOCK_WINDOW=notepad`

---

# 8. Environment Configuration

## P8.5 Planner / Agent

| Variable | Purpose | Default |
|----------|---------|---------|
| `RIPPLE_P85_PLANNER_V2` | v2 rollout: `0` off, `1` compound, `2`/`all` atomic+compound | Off |
| `RIPPLE_P85_PHASE_B` | Compound split/execute stages | Off |
| `RIPPLE_P85_TOOL_EXECUTOR` | Route through tool executor | **On** (`=0` disables) |
| `RIPPLE_P85_KILL` | Disable P8.5, legacy only | Off |
| `RIPPLE_P85_TRACE` | Planner branch logging | On unless `=0` |
| `RIPPLE_P85_SHADOW` | Shadow parity logging | On unless `=0` |
| `RIPPLE_P85_RECOVERY` | Step recovery engine | On unless `=0` |
| `RIPPLE_P85_CACHE` | Plan result cache | On unless `=0` |
| `RIPPLE_P85_SKIP_GPT` | Disable GPT fallback | Off |
| `RIPPLE_P85_CONF_EXECUTE` | Min confidence to execute | `0.8` |
| `RIPPLE_P85_CONF_CLARIFY` | Below → clarification | `0.2` |
| `RIPPLE_P85_CONF_DESTRUCTIVE` | Min for delete etc. | `0.95` |
| `RIPPLE_P85_LEGACY_*` | Force specific legacy routers | Off |

## OS / UI Testing

| Variable | Purpose | Default |
|----------|---------|---------|
| `OS_TEST_LOCK_WINDOW` | Fail if foreground ≠ named window | Unset (script defaults `notepad` in os-only) |
| `RIPPLE_OS_TEST` | Enable file bridge | Off |
| `RIPPLE_OS_FILTER` | Run single case e.g. `E7-01` | All |
| `RIPPLE_UI_CDP_PORT` | CDP for UI matrix | `9333` |

## API / Backend

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_API_URL` | REST API base | `http://127.0.0.1:3007/api/v1` |
| `VITE_SOCKET_URL` | Socket origin | Derived from API URL |
| `RIPPLE_TEST_TOKEN` | Live E2E JWT | None |

## Native / CDP / Bridges

| Variable | Purpose | Default |
|----------|---------|---------|
| `RIPPLE_NATIVE_EXE` | Override native binary path | Auto/bundled |
| `RIPPLE_CDP_PORT` | Chrome DevTools port | `9222` |
| `RIPPLE_BRIDGE_PORT` | WhatsApp WS bridge | `9333` |
| `RIPPLE_USE_CDP` | WhatsApp via CDP | Off |
| `RIPPLE_USE_WS_BRIDGE` | Extension WS fallback | Off |

See `.env.example` for dev comments. Full list: 50+ vars referenced in `electron/` and `scripts/`.

---

# 9. Current Completion Status

| Phase | Status | Completion | Notes |
|-------|--------|------------|-------|
| Phase 0 Scaffold | ✅ Complete | 100% | electron-vite, React shell |
| Phase 1–2 Backend | ✅ Complete | 100% | Separate `ripple-backend` repo |
| Phase 3 Voice Shell | ✅ Complete | 100% | Tray, overlay, action runner |
| Phase 3.5 Web Apps | ✅ Complete | ~95% | Slack deferred |
| Phase 4 Desktop NLU | ✅ Complete | ~90% | Ongoing fixture expansion |
| Phase 5 Retriever | ✅ Complete | ~85% | Entity resolver partial in planner |
| Phase 6 Telemetry | ✅ Complete | 100% | CI gate live |
| Phase 7 Native | ✅ Core complete | ~90% | OCR click, signing deferred |
| Phase 8/8b Memory | ✅ Shipped | ~80% | Integrated in retriever |
| Phase 8.5 Planner | 🟡 In progress | ~72% | Per P8.5-REMAINING.md |
| Phase 9 Agent | 🔴 Scaffold | ~10% | Observer only |
| Phase 1.5 Capabilities | 🔴 Not started | 0% | Planned next |
| Design IR / Canva | 🔴 Deferred | 0% | Explicitly out of scope |

## P8.5 Internal Breakdown

| Sub-phase | Status |
|-----------|--------|
| Scaffold + desktop tools | ✅ |
| Safety + pipeline | ✅ |
| Shadow parity | ✅ |
| Planner v2 L2–L5 | ✅ v2.0–v2.4 |
| Router deletion | 🟡 Started |
| Tool catalog completion | 🟡 Started |
| Production metadata §15 | 🔴 Open |

---

# 10. Remaining Work

## Phase 7 Remaining
- OCR-guided UI click ("click Save button")
- Native binary code signing / scheduled task auto-start
- Keys into elevated admin windows (blocked by design)

## Phase 8.5 Remaining (from `P8.5-REMAINING.md`)

### Phase 4 — Delete routers (~8%)
- [ ] Delete dead `desktop-fast` router functions
- [ ] Remove WhatsApp/LinkedIn/YouTube early orchestrator blocks → tools
- [ ] Single orchestrator entry
- [ ] Shadow metrics green before final deletion

### Phase 5 — Tool catalog (~11%)
- [ ] `browser.whatsapp.send`, `browser.gmail.compose` with registry `execute()`
- [ ] L0 fixtures for all file-op variants in shadow parity

### Pipeline / production metadata (~13%)
- [ ] Plan validator early pass before GPT
- [ ] Full entity resolver (files, contacts, graph)
- [ ] `canRipple()` wired into validation preflight
- [ ] Failure taxonomy typed in recovery
- [ ] Stage latency metrics

### Success criteria gaps
- [ ] Multi-step E2E through executor only (no `_desktopPayload` bridge)
- [ ] +30 executor integration tests
- [ ] Manifest auto-gen with per-tool examples

## Phase 1.5 — Capability System (agreed next)
- [ ] Create `electron/capabilities/` (paint, notepad modules)
- [ ] Capability → platform adapter → OS pattern
- [ ] Harden plan validator (bad plans never hit executor)
- [ ] Persist `plannerMemory` beyond process lifetime

## Phase 4 (User term) — Agent Intelligence
- Long workflows, self-correction, observation loop
- Structured compound context to GPT (not raw re-parse)
- **Not** the same as P8.5 "Phase 4 delete routers"

## Future Work (explicitly NOT current scope)
- Design IR, Canva/Figma templates
- Paint erase/label/clear edge-case polish (E4-M02, X01)
- Event bus, plugins, execution graph (P9)
- Full browser tool suite
- Slack integration

## Technical Debt
- **Decentralized planning:** 8+ plan construction paths (`P8.5-RUNTIME-GRAPH.md`)
- Legacy payload bridge still used for communication tools
- `plannerMemory` in-memory only
- World model does not include OCR text

---

# 11. Final Architecture Vision

## Current State (July 2026)

Ripple Desktop is a **working voice-driven control agent** for Windows with:
- Proven desktop execution (E1–E7 matrix, clipboard hardened)
- Production P8.5 planner path with tool executor default-on
- Rust native sidecar for reliable input injection
- Rich NLU for multilingual compound commands

## What Is Ready
- Voice → plan → validate → execute loop for desktop + filesystem
- Native keyboard/mouse/window/UIA/OCR RPC surface
- Shadow parity infrastructure for safe router migration
- OS test harness for real-world verification

## What Is Not Ready
- Single authoritative planner (decentralized paths remain)
- Formal per-app capability modules
- Persistent planner memory and full entity resolution
- Communication tools as first-class registry executors
- Agent observe/replan loop (P9)
- Vision/OCR in planning loop

## Transition Path

```
TODAY                          NEAR (Phase 1.5)              THEN (Agent + P8.5 complete)
─────                          ────────────────              ────────────────────────────
L0 + compound + v2             electron/capabilities/        Single orchestrator
Tool executor default          Validator hardening             Router deletion done
Legacy routers (dying)         canRipple preflight             browser.* tools registered
Payload bridge for comms       Persisted memory                GPT gets compound context
In-memory planner memory       File/contact entity resolver    P9 observe/replan loop
```

## Target End State (Post P8.5)

```
Transcript → normalize → classify (atomic | compound)
    → runAtomicPlanner | runCompoundPlanner
    → validatePlan (early + final)
    → Tool Executor (all tools registered)
    → Native layer
    → OS
```

No full-string re-parse after compound split. No parallel legacy routers. Bad plans never reach execution.

---

## Document Provenance

| Source | Used for |
|--------|----------|
| Source code (`electron/`, `ripple-native/`, `src/`) | Primary verification |
| `docs/P8.5-REMAINING.md` | P8.5 completion % |
| `docs/PHASE-7-AND-P85-COMPLETED.md` | P7 + P8.5 module list |
| `docs/PHASE-3-THROUGH-6-COMPLETED.md` | Phases 3–6 history |
| `docs/P8.5-RUNTIME-GRAPH.md` | Architecture invariants |
| `scripts/ui-test-p85-os.mjs` | E1–E7 test matrix |
| `package.json` | Test scripts |

Items marked *"Historical phase information based on repository documentation"* were not independently re-verified in `ripple-backend/` source during this pass.

---

*This document is the engineering handoff single source of truth for Ripple Desktop Phase 0 through Phase 8.5. Update when Phase 1.5 capabilities land or P8.5 router deletion completes.*
