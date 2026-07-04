# P7 — Native Layer Features (What Works Today)

**Project:** Ripple Desktop  
**Platform:** Windows 10/11  
**Binary:** `ripple-native.exe` (Rust sidecar)  
**IPC:** Authenticated named pipe (`\\.\pipe\Ripple.Native.{pid}`)

This document lists **what P7 delivers in the current build** — native RPCs, voice commands wired to them, and what is still planned.

---

## Architecture (short)

```
Voice / hotkey → Electron main → win32Bridge.ts → named pipe → ripple-native.exe
                                                      ↓
                                            SendInput / UIA / OCR / hooks
```

PowerShell fallback still exists when the sidecar is down; production paths prefer the native binary.

---

## P7 phases — status

| Phase | Feature | Status |
|-------|---------|--------|
| **P7a** | Rust sidecar, session token, pipe auth | Done |
| **P7b** | Global hotkey (`RegisterHotKey` → `voice` event) | Done |
| **P7c** | Foreground tracking, window focus/close/list/rect | Done |
| **P7d** | `send_keys`, `run_input_sequence` (SendInput) | Done |
| **P7e** | UI Automation — `get_focused_a11y` | Done |
| **P7f** | OCR — `screenshot_ocr`, `list_windows`, bundle in installer | Done |
| **P7g** | Mouse — click, scroll, drag, move, cursor position | Done |

### Not done / polish

- OCR-guided click (“click Save button”) — OCR exists, not fully wired to voice
- Code signing (`scripts/sign-native.ps1`)
- Task Scheduler auto-start (`scripts/register-native-task.ps1`)
- Keys into elevated/admin windows (blocked by design)
- napi-rs in-process addon (future optimization)

---

## Native RPC methods

| Method | Purpose |
|--------|---------|
| `auth` | Handshake with session token |
| `ping` | Health check |
| `get_capabilities` | Protocol version + feature flags |
| `get_foreground` | HWND, process, title of foreground window |
| `send_keys` | Type text or key chords (`^a`, `{ENTER}`, etc.) |
| `run_input_sequence` | Multi-step key/mouse sequence with delays |
| `get_focused_a11y` | Focused control name, type, value (UIA) |
| `focus_window` | Bring window to foreground by HWND/title |
| `close_window` | Close window by HWND |
| `list_windows` | Enumerate visible top-level windows |
| `get_window_rect` | Window bounding rectangle |
| `screenshot_ocr` | Screen region OCR (WinRT) |
| `mouse_click` | Left/right click at coordinates |
| `mouse_scroll` | Wheel scroll |
| `mouse_drag` | Drag from → to |
| `mouse_move` | Relative or absolute cursor move |
| `get_cursor_position` | Current mouse X/Y |

### Events (native → Electron)

| Event | When |
|-------|------|
| `hotkey` | User pressed registered global hotkey (e.g. voice) |
| `foreground_changed` | Active window changed |

---

## Voice commands using P7 (local fast path)

These are handled **without GPT** when phrased as below. Urdu Arabic-script variants are supported for edit commands.

### Keyboard & editing

| Say (English) | Urdu (Arabic script) | Action |
|---------------|----------------------|--------|
| `Select all` | `سب سلیکٹ` / `سیلیکٹ سب` | Ctrl+A |
| `Copy` | `کاپی کرو` | Ctrl+C |
| `Paste here` | `یہاں پےسٹ` / `پےسٹ کرو` | Ctrl+V |
| `Select all and copy` | `سیلیکٹ اول اینڈ کاپی` | Ctrl+A then Ctrl+C |
| `Select all and cut` | — | Ctrl+A then Ctrl+X |
| `Press Enter` / `Tab` / `Escape` / `Backspace` / `Delete` | — | Key send |
| `Scroll up` / `Scroll down` | `سکرول اوپر` / `سکرول نیچے` | Page Up / Page Down |
| `Move cursor left/right/up/down` | — | Arrow keys |

### Mouse (P7g)

| Say | Action |
|-----|--------|
| `Move mouse left/right/up/down` | `ماؤس بائیں/دائیں/اوپر/نیچے` — relative move |
| `Move mouse to center` | Cursor to screen center |
| `Click here` / `Double click` | Click at current position |

### Typing

| Say | Action |
|-----|--------|
| `Type hello world` | Sends literal text via SendInput |
| `Write 25` (in Calculator) | Calculator key input |
| `Delete this text and write …` | Replace-all typing |

### Apps & windows (P7c + desktop planner)

| Say | Action |
|-----|--------|
| `Open Notepad` / `VS Code kholo` | Launch or focus app |
| `Switch to Chrome` | `focus_window` |
| `Close Notepad` | `close_window` |
| `Open downloads` / `ڈاؤنلوڈ کھولو` | File/folder open via planner |

---

## Test scripts

```bash
npm run native:build
npm run native:test-send    # P7d SendInput
npm run native:test-a11y    # P7e UIA
npm run native:test-ocr     # P7f OCR
npm run native:test-mouse   # P7g mouse
```

---

## Good log lines (working)

- `command:result intent=typing … (desktop-input-early)` or `(desktop-input-fast)`
- `Executed key command: ^a` / `^c` / `^v` / `{PGDN}`
- `Copied N chars to clipboard` / `Pasted N chars from clipboard`
- `editor click → Cursor` (Electron editor focus before keys)
- `voice target: Cursor` (focus not stolen by Explorer/WhatsApp)

## Bad log lines (needs fix or rephrase)

- `GPT planner: raw speech only` for simple edit commands
- `LLM desktop intent failed: Not a desktop command`
- `(whatsapp-early)` when you meant desktop edit
- `focus skip weak window` during voice capture

---

## Related docs

- [P7-NATIVE-LAYER-PLAN.md](./P7-NATIVE-LAYER-PLAN.md) — full implementation plan
- [DESKTOP-AUTOMATION-COMMANDS.md](./DESKTOP-AUTOMATION-COMMANDS.md) — user-facing command phrases
