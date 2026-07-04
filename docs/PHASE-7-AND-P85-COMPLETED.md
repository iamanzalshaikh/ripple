# Phase 7 & P8.5 — Completion Status

**Project:** Ripple Desktop  
**Last updated:** July 2026  
**Specs:** `ripple/new8.5.md` (P8.5), `docs/P7-NATIVE-LAYER-PLAN.md` (P7)

This document records **what is built and working today** for Phase 7 (native hands/eyes) and Phase 8.5 (universal intent planner). It is the handoff snapshot after P7 final polish and P8.5 Wave 1 + Wave 2 scaffolding.

---

## Architecture (current)

```
Voice hotkey
    ↓
Whisper (STT) → normalize → commandOrchestrator
    ↓
P8.5: Intent Normalizer → World Model → L0 Planner → (cache → grounded → GPT)
    ↓
Plan Validator → executionPlanToPayload → runCommandActions
    ↓
P7: ripple-native.exe (SendInput / UIA / mouse / OCR) + win32Bridge PowerShell fallback
```

| Layer | Role | Status |
|-------|------|--------|
| **P7** | Win32, keyboard, mouse, UIA, OCR, focus | ✅ Core complete + final polish |
| **P8.5** | Natural language → validated tool calls | ✅ Desktop path live; Wave 2 in progress |
| **P9** | Observe → retry → replan agent loop | 🔜 Scaffold only |

---

# Phase 7 — Native Layer (Completed)

## P7 phases (a–g)

| Phase | Feature | Status |
|-------|---------|--------|
| **P7a** | Rust sidecar (`ripple-native.exe`), session token, named pipe auth | ✅ |
| **P7b** | Global hotkeys (`RegisterHotKey` → voice / escape events) | ✅ |
| **P7c** | Foreground tracking, `focus_window`, `close_window`, `list_windows`, `get_window_rect` | ✅ |
| **P7d** | `send_keys`, `run_input_sequence` (SendInput) | ✅ |
| **P7e** | UI Automation — `get_focused_a11y` | ✅ |
| **P7f** | OCR — `screenshot_ocr`, window list, installer bundle | ✅ |
| **P7g** | Mouse — click, scroll, drag, move, cursor position | ✅ |

## Native RPC surface

| Method | Purpose |
|--------|---------|
| `auth` / `ping` / `get_capabilities` | Sidecar handshake and health |
| `get_foreground` | Active window HWND, process, title |
| `send_keys` / `run_input_sequence` | Keyboard chords and sequences |
| `get_focused_a11y` | Focused control (UIA) |
| `focus_window` / `close_window` | Window management |
| `list_windows` / `get_window_rect` | Window enumeration and geometry |
| `screenshot_ocr` | Region OCR (WinRT) |
| `mouse_click` / `mouse_scroll` / `mouse_drag` / `mouse_move` | Pointer control |
| `get_cursor_position` | Current mouse X/Y |

**Native events:** `hotkey`, `foreground_changed`

## Electron bridge (`win32Bridge.ts`)

- Primary path: authenticated RPC to `ripple-native.exe`
- **PowerShell fallback** when sidecar unavailable or RPC fails:
  - Keyboard: `sendKeys`, `runSequence`
  - Mouse: `mouseClick`, `mouseMove`, `mouseScroll`, `getCursorPosition`
  - Geometry: `getScreenMetrics`, `getWindowAtPoint` (WindowFromPoint + GetAncestor)
  - Focus: `getForeground`, `focusHwnd`, `getFocusedA11y`

## P7 final polish (July 2026)

| Item | What it does |
|------|----------------|
| **Hybrid voice targeting** | Valid foreground wins; if Program Manager / weak shell → `WindowFromPoint(mouse)` |
| **Program Manager rejection** | Explorer desktop shell never used as typing target |
| **Mouse vs text caret** | `move the/my mouse up` = physical pointer; `move cursor up` = `{UP}` |
| **Caret focus (hybrid)** | Navigation keys: skip click if already in editor; else click at mouse position over target window |
| **Multi-monitor mouse** | `mouse.rs` uses virtual desktop metrics (`SM_XVIRTUALSCREEN`, etc.) |
| **Mouse elevation guard** | Blocks injection into elevated windows at cursor point |
| **Screen center fallback** | `getPrimaryScreenCenter()` replaces hardcoded 960×540 |
| **Notepad / classic editors** | No parent HWND on `send_keys`; editor body click; clipboard probe on copy/cut |
| **Navigation verify** | Arrow/home/end/pgup/pgdn skip heavy `foreground_changed` checks |
| **Copy/cut verification** | Clipboard probe token — success only if clipboard actually changes |

## Voice → P7 paths (working)

| Category | Examples | Execution |
|----------|----------|-----------|
| Type text | “type hello”, “likho hello” | `smartInsert` / SendInput |
| Edit keys | select all, copy, cut, paste, undo | P7 `send_keys` / sequences |
| Caret move | “move cursor down/end”, “cursor left 5” | `{DOWN}`, `{END}`, arrow sequences |
| Scroll | “scroll up/down”, “page down” | `{PGUP}` / `{PGDN}` |
| Mouse | “move my mouse left”, “click here” | `mouse_move` / `mouse_click` |
| Clear | “delete all text”, “clear everything” | Ctrl+A + Backspace sequence |
| Calculator | spoken math when Calculator focused | Literal key input |

## P7 not done (explicitly deferred)

- OCR-guided click (“click Save button” by label)
- Code signing / Task Scheduler auto-start scripts
- Keys into elevated/admin windows (blocked by design)
- napi-rs in-process addon

**Related doc:** [P7-FEATURES.md](./P7-FEATURES.md)

---

# Phase 8.5 — Universal Intent Planner (Completed to date)

## Role

P8.5 converts messy natural language into **validated, ordered tool calls**. P7 executes them blindly. P8.5 never calls Win32 directly.

## Implemented modules

| Module | File | Status |
|--------|------|--------|
| Tool registry + manifest | `toolDefinitions.ts`, `toolManifest.json` | ✅ |
| Intent normalizer | `intentNormalizer.ts` | ✅ |
| World model | `worldModel.ts` | ✅ (+ mouse position, window-under-cursor) |
| L0 planner | `l0Planner.ts` | ✅ |
| L0 compound | `l0CompoundPlanner.ts` | ✅ |
| Pipeline (sync) | `plannerPipeline.ts` | ✅ L0 → validate → execute/defer/clarify |
| Pipeline (async) | `plannerPipeline.ts` | ✅ cache → grounded → GPT fallback |
| Plan validator | `planValidator.ts` | ✅ + `unbridged_tool` gate |
| Confidence engine | `confidenceEngine.ts` | ✅ P8.5f |
| Clarification engine | `clarificationEngine.ts` | ✅ P8.5g + overlay UI |
| Recovery engine | `recoveryEngine.ts` | ✅ P8.5j transient retry + stale replan hook |
| Plan cache | `planCache.ts` | ✅ in-memory, manifest-version-aware |
| GPT bridge | `gptPlannerBridge.ts`, `gptPlanMapper.ts` | ✅ |
| Grounded bridge | `groundedPlannerBridge.ts` | ✅ file/app lookup deferrals |
| Executor bridge | `plannerExecutor.ts`, `executionPlanToPayload.ts` | ✅ plan → `CommandResultPayload` |
| Plan logger + shadow | `planLogger.ts`, `planPersistence.ts` | ✅ SQLite `planner_shadow` |
| Metrics dashboard | `planMetricsDashboard.ts` | ✅ session + telemetry IPC |
| Router parity | `routerParity.ts` | ✅ mismatch tracking, `readyForDeprecation` |
| Execution observer | `executionObserver.ts` | ✅ P9 prep |
| Utterance fixtures | `utteranceFixtures.ts` | ✅ ~29 regression fixtures |
| Orchestrator entry | `commandOrchestrator.ts` → `tryP85FastPath` | ✅ `p85-desktop-early` |

## Pipeline flow

```
normalizeIntent(command)
    ↓
runL0Planner(world)     → execute | clarify | defer
    ↓ (defer + token)
lookupCachedPlan
    ↓
tryGroundedPlannerResult  (file/app open)
    ↓
tryGptPlannerFallback     (backend desktop-intent API)
    ↓
validatePlan → buildExecutorPayload → runCommandActions
    ↓
attemptP85Recovery        (bounded retries)
```

## Tools bridged to P7 (execute today)

| Tool | Bridges to |
|------|------------|
| `desktop.type_text` | `INSERT_TEXT` / `smartInsert` |
| `desktop.press_keys` | `INSERT_TEXT` keys / sequences |
| `desktop.copy` / `paste` / `select_all` | Key chords |
| `desktop.mouse_click` | `mouseClickNative` (x/y supported) |
| `desktop.mouse_move` | Relative, absolute, move-to-center |
| `desktop.mouse_scroll` | `mouseScrollNative` |
| `desktop.launch_app` | `_nativeIntent` / `_desktopPayload` bridge |

## World model snapshot

```ts
{
  foreground,           // voice/typing target preferred
  focusedField,         // UIA focused control
  focusContext,         // sticky web / app flags
  mouse: {
    x, y,
    windowUnderCursor,
    monitorHandle
  },
  browser: { surface, tabUrl },
  clipboard: { hasText, preview, length },
  capabilities: { sidecar, sendInput, uia, ocr },
  activeGoal
}
```

## Orchestrator routing (current)

1. Undo / goals / referential WhatsApp / LinkedIn local  
2. **`p85-desktop-early`** — full P8.5 pipeline (primary desktop path)  
3. Legacy `desktop-input` / `desktop-fast` — **shadow-only** (logs mismatch, not executed by default)  
4. `agent-compound` — env-gated; simple compounds handled by L0  
5. `planDesktopCommand` — env-gated (`RIPPLE_P85_LEGACY_PLAN`)

## Environment flags

| Variable | Default | Effect |
|----------|---------|--------|
| `RIPPLE_P85_SHADOW` | on | Log `[ripple-p85] shadow …` |
| `RIPPLE_P85_KILL` | off | Skip P8.5; legacy only |
| `RIPPLE_P85_CACHE` | on | GPT plan cache |
| `RIPPLE_P85_RECOVERY` | on | Executor failure recovery |
| `RIPPLE_P85_PERSIST` | on | SQLite planner shadow |
| `RIPPLE_P85_LEGACY_*` | off | Re-enable old routers |

## Telemetry & UI

- IPC: `telemetry:p85`, `telemetry:p85:export`
- Observability page → P8.5 Universal Planner section
- Console: every 25 executes → `[ripple-p85] dashboard …`
- Tracks: L0 hit rate, GPT fallback %, cache size, router mismatches

## Backend GPT

`ripple-backend` desktop-intent supports:

- `type_text` / `compose_text` with `entities.text`
- Optional `steps[]` for multi-step plans
- `intent_hint: compose_text` for compose deferrals

## Tests

```bash
cd ripple-desktop
npm run test:p85      # ~180 tests (planner, validator, fixtures, wave2, dashboard)
npm run native:build
npm run native:test-send
npm run native:test-mouse
```

Test files:

- `phase-p85-planner.spec.ts`
- `phase-p85-plan-validator.spec.ts`
- `phase-p85-utterance-fixtures.spec.ts`
- `phase-p85-wave2.spec.ts`
- `phase-p85-dashboard.spec.ts`
- `phase-p85-tool-manifest.spec.ts`
- `phase-p9-agent.spec.ts`
- `key-sequence-helpers.spec.ts`

---

# P8.5 — Still remaining (not “done” per spec)

Use this section to know what is **not** finished; do not confuse with the completed work above.

| Area | Gap |
|------|-----|
| **Router migration** | Legacy routers still exist behind flags; `readyForDeprecation` not met in production |
| **Unbridged tools** | `focus_window`, `close_window`, `memory.search`, `browser.*`, `system.clipboard.*` — in manifest but validator blocks until bridged |
| **Fixture coverage** | Spec targets 100+ utterances; ~29 fixtures today |
| **Plan cache** | In-memory only — no disk persistence across restarts |
| **World model redaction** | Sensitive field stripping before GPT not implemented |
| **Mouse click-by-target** | OCR/UIA-resolved click (Wave 2) not built |
| **P9 agent loop** | Full observe/retry/replan — scaffold only |

---

# Key file map

## P7

| Area | Path |
|------|------|
| Native binary | `ripple-native/src/` |
| Mouse | `ripple-native/src/mouse.rs` |
| SendInput | `ripple-native/src/send_input.rs` |
| Bridge | `electron/native/win32Bridge.ts` |
| Focus / voice target | `electron/focus/focusContext.ts` |
| Editor caret focus | `electron/agent/editorFocus.ts` |
| Key delivery + retry | `electron/agent/retryTyping.ts` |
| Action runner | `electron/automation/actions/insertText.ts` |
| Desktop input parser | `electron/agent/parseDesktopInput.ts` |

## P8.5

| Area | Path |
|------|------|
| Entry / orchestrator | `electron/services/commandOrchestrator.ts` |
| Universal planner API | `electron/agent/universalPlanner.ts` |
| Pipeline | `electron/agent/planner/plannerPipeline.ts` |
| L0 | `electron/agent/planner/l0Planner.ts` |
| Validator | `electron/agent/planner/plannerValidator.ts` |
| Payload bridge | `electron/agent/planner/executionPlanToPayload.ts` |
| World model | `electron/agent/worldModel.ts` |
| Spec | `ripple/new8.5.md` |
| Status doc | `docs/P8.5-UNIVERSAL-PLANNER.md` |

---

# Definition of “done” (roadmap)

```
✅ P7   — Native OS capabilities (hands & eyes) + final polish
🚀 P8.5 — Universal Intent Planner (brain) — desktop path live; Wave 2 closing out
🧠 P9   — Agent brain (observe → retry → replan) — next
```

**P8.5 ships** when: legacy routers retired, all manifest tools execute or are hidden from GPT, fixture + parity metrics justify cutover, then freeze and start P9.
