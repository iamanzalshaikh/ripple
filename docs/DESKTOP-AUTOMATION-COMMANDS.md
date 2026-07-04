# Ripple Desktop — Voice & Text Automation Commands

This guide lists what Ripple can do **today** on Windows, how to phrase commands so they work reliably, and what is **not** supported yet.

---

## How it works (important)

Ripple has **two layers** for understanding commands:

| Layer | What it does |
|-------|----------------|
| **Local parsers** | Fast, exact phrase matching — very reliable |
| **AI backend (GPT)** | Handles flexible language — can miss or return wrong intent |

For **typing and keyboard control**, Ripple uses a **local fast path** when you say phrases that match exactly (see §2). If you say something creative like *"put hello there"*, the AI may not map it to typing.

### Rules for reliable automation

1. **Click inside the target app first** — Ripple types into whatever window has keyboard focus.
2. **Use the phrases below** — especially for type / edit / cursor commands.
3. **Say commands in English** for edit keys (select all, cut, paste). Urdu/Hindi works for some file/undo commands, not all typing edits.
4. **Works in most desktop apps** — Notepad, Word, VS Code, Cursor, Chrome (when a text field is focused), Excel, etc.
5. **Does NOT work in admin apps** — Task Manager (elevated), admin PowerShell, UAC dialogs.
6. **Web apps use special adapters** — Gmail, WhatsApp, Instagram, LinkedIn, YouTube, Notion have their own flows; plain typing fallback is disabled there.

---

## 1. App control (any registered app)

Works for native Windows apps and common installed apps.

| Say this | What happens |
|----------|----------------|
| `Open Notepad` | Launches Notepad |
| `Open Calculator` | Launches Calculator |
| `Open Chrome` / `Open VS Code` / `Open Cursor` | Launches app |
| `Open Task Manager` | Opens Task Manager |
| `Open Paint` / `Open File Explorer` | Launches app |
| `Switch to Notepad` / `Focus Chrome` | Brings app window to front |
| `Close Notepad` / `Quit Chrome` | Closes app window |
| `Minimize all windows` | Minimizes all windows |

**Built-in apps:** Calculator, Paint, Notepad, Snipping Tool, Photos, Camera, File Explorer, Clock, Sticky Notes.

**Common apps:** VS Code, Cursor, Chrome, Edge, Firefox, Spotify, Discord, Task Manager.

More apps are discovered from your Start Menu automatically.

**Web-only (not native launch):** Gmail, WhatsApp, Notion, YouTube, LinkedIn, Instagram — use `Open Gmail` etc. via browser/extension flows.

---

## 2. Typing & keyboard (works in any focused text field)

These run through the **local desktop-input fast path** — use these exact patterns for best results.

### Type text

| Say this | Example |
|----------|---------|
| `Type hello world` | Types `hello world` |
| `Type exactly "hello world"` | Types with quotes stripped |
| `Insert text hello` | Same as type |
| `Delete this text and write, How are you` | Select-all → delete → type new text |

### Keys

| Say this | Sends |
|----------|-------|
| `Press Enter` | Enter |
| `Press Tab` | Tab |
| `Press Backspace` | Backspace |
| `Press Delete` | Delete |
| `Press Escape` | Escape |

### Edit shortcuts

| Say this | Sends |
|----------|-------|
| `Select all` | Ctrl+A |
| `Copy` / `Copy this` | Ctrl+C |
| `Cut` / `Cut this` | Ctrl+X |
| `Paste` / `Paste here` | Ctrl+V |
| `Undo` / `Undo that` | Ctrl+Z |
| `Redo` | Ctrl+Y |
| `Select all and cut` | Ctrl+A then Ctrl+X |
| `Select all and copy` | Ctrl+A then Ctrl+C |
| `Delete last word` | Ctrl+Shift+Left, Backspace |
| `Delete last line` | Shift+Home, Backspace |

### Cursor movement

| Say this | Sends |
|----------|-------|
| `Move cursor left` | Arrow left (1 step) |
| `Move cursor left 5` | Arrow left ×5 |
| `Move cursor right 3` | Arrow right ×3 |
| `Go up` / `Go down` | Arrow up / down |
| `Move cursor to start` | Home |
| `Move cursor to end` | End |

---

## 3. Folders & files

| Say this | What happens |
|----------|----------------|
| `Open Downloads` | Opens Downloads folder |
| `Open Documents` / `Open Desktop` | Opens folder |
| `Open report.pdf` | Searches and opens file |
| `Open Flow in Downloads` | Opens item in folder |
| `Open folder Projects in Documents` | Opens subfolder |

### File operations

| Say this | What happens |
|----------|----------------|
| `Create folder Projects in Downloads` | Creates folder |
| `Create file notes.txt in Documents` | Creates file |
| `Rename old.txt to new.txt` | Renames file |
| `Move file.zip from Downloads to Desktop` | Moves file |
| `Delete oldfile.txt in Downloads` | Deletes (may ask confirm) |

### Undo

| Say this | What happens |
|----------|----------------|
| `Undo` / `Undo last action` | Reverts last file action |
| `Wapas karo` / `Undo kar do` | Urdu undo |

---

## 4. System

| Say this | What happens |
|----------|----------------|
| `Lock my PC` | Locks workstation |
| `Open Settings` / `Open Windows Settings` | Opens Settings |
| `Open Bluetooth settings` | Opens Bluetooth |
| `Open WiFi settings` | Opens network settings |
| `Open Control Panel` | Opens Control Panel |

---

## 5. Workflows & aliases

| Say this | What happens |
|----------|----------------|
| `Remember workflow morning as open notepad, type hello` | Saves multi-step workflow |
| `Run morning` | Runs saved workflow |
| `List workflows` | Lists saved workflows |
| `Remember my invoices is in Documents` | Saves path alias |
| `Open invoices` | Opens aliased path |

---

## 6. Smart search (files by time / topic)

Examples (flexible wording, index-backed):

- `Open last downloaded file`
- `Open PDF I edited yesterday`
- `Open file about taxes`

---

## 7. Hotkeys (no voice needed)

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` | Voice overlay |
| `Alt+Shift+Space` | Alternate voice trigger |
| `Escape` | Cancel / dismiss |

---

## What works in other apps?

**Yes** — if the app accepts normal keyboard input:

| App type | Typing | Edit keys | Notes |
|----------|--------|-----------|-------|
| Notepad, Word, VS Code | ✅ | ✅ | Best for testing |
| Chrome / Edge (text field focused) | ✅ | ✅ | Click search bar or compose box first |
| Excel (cell focused) | ✅ | ✅ | Click cell first |
| Games, custom UIs | ❌ | ❌ | Often block synthetic input |
| Task Manager (admin) | ❌ | ❌ | UIPI blocked |
| Remote desktop / VM | ⚠️ | ⚠️ | May be flaky |

Ripple does **not** move the **mouse pointer** or click buttons yet. You must focus the field yourself, then say `Type ...` or `Press ...`.

---

## What is NOT supported yet

| Feature | Status |
|---------|--------|
| Mouse move / click / drag / scroll | ❌ Not built |
| Click a button by name ("click Save") | ❌ Not built (UIA read only) |
| OCR in voice flow (read screen) | ✅ RPC exists, not wired to voice yet |
| Natural language typing ("write something nice") | ❌ Use exact `Type ...` phrase |
| Urdu/Hindi edit commands (`سب منتخب کریں`) | ❌ English edit phrases only |
| Typing into elevated/admin windows | ❌ Blocked by Windows |
| Code signing / installer polish | ⏳ P7f partial |
| Native RPC for focus/close/minimize window | ⏳ Still PowerShell fallback |

---

## Troubleshooting

### Command does nothing

1. Check dev console for `[ripple-native] P7 host ready — sidecar=true`
2. Click inside the target app so it has focus
3. Use exact phrases from §2
4. Restart: `npm run native:build` then `npm run dev`

### Wrong action (e.g. delete file instead of delete text)

Use the full phrase: `Delete this text and write, your new text` — not just `delete this`.

### `SHOW_SUGGESTIONS` in logs

Backend did not understand — rephrase using this doc.

### Sidecar / pipe errors

```powershell
taskkill /IM ripple-native.exe /F /T
cd ripple-desktop
npm run native:build
npm run dev
```

---

## Quick test script (2 minutes)

1. `npm run dev`
2. `Open Notepad` → click in Notepad
3. `Type hello world`
4. `Select all and cut`
5. `Type Ripple works`

If all five work, native automation is healthy.

---

## See also

- [P7-NATIVE-LAYER-PLAN.md](./P7-NATIVE-LAYER-PLAN.md) — native sidecar architecture
- Test scripts: `npm run native:test-send`, `native:test-a11y`, `native:test-ocr`
