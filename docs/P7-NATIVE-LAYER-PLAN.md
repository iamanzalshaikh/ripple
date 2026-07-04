# P7 — Native OS Layer — Implementation Plan

**Project:** Ripple Desktop  
**Platform (v1):** Windows 10/11  
**Status:** Scaffold exists (PowerShell bridge + Electron hotkeys) — production native helper not built yet  
**Target:** Wispr / Raycast-class OS presence — global hotkey, reliable foreground, real SendInput, accessibility reads  
**Last updated:** June 2026 (rev 3 — security limits, liveness, crash recovery)

---

## 1. Executive summary

P7 adds a **small native helper process** (`ripple-native.exe`) that runs beside Electron and talks to Ripple over **authenticated local IPC**.

| Question | Answer |
|----------|--------|
| **Rust or C++?** | **Rust** — sidecar `ripple-native.exe` |
| **IPC transport?** | **Named pipe** (primary) — not raw TCP. Chrome bridge keeps TCP; OS layer does not. |
| **Why not stay on PowerShell?** | Too slow (~200–800ms per call), spawns a process each call, flaky focus/SendKeys |
| **When to start?** | Now — P8 memory layer is ~90% done and orthogonal to P7 |
| **Duration** | **6–10 weeks part-time** for P7a–P7e if new to Rust + Win32; **4–6 weeks** if comfortable |

---

## 2. What P7 gives you (vs today)

| Capability | Today (pre-P7) | After P7 |
|------------|----------------|----------|
| Global voice hotkey | Electron `globalShortcut` — only while Ripple runs | Native `RegisterHotKey` in sidecar — always on |
| Foreground window | PowerShell poll every 500ms | `SetWinEventHook` + cached HWND — &lt;5ms read |
| Type into Notepad/Excel | `SendKeys` + clipboard paste | Real `SendInput` / UIA |
| IPC security | N/A | User-SID pipe DACL + token (same-user malware not in scope v1) |
| Elevated target apps | Not addressed | **Explicitly out of scope** (see §8) |
| Chrome extension bridge | `native-host.js` (Node, TCP) | **Unchanged** — separate concern |

---

## 3. Current codebase (starting point)

```
ripple-desktop/
├── electron/native/
│   ├── nativeHost.ts          # P7 capability probe
│   ├── win32Bridge.ts         # PowerShell dispatcher → replace with pipe IPC
│   ├── hotkeyRegistry.ts      # Electron globalShortcut (FALLBACK only)
│   └── types.ts
├── electron/focus/focusContext.ts
└── native-host/               # Chrome NM bridge — NOT P7 (keeps TCP)
```

`win32=true` in logs today means *PowerShell bridge exists*, not a compiled binary.

---

## 4. Language decision: Rust vs C++

### Recommendation: **Rust sidecar** (separate process)

| Criteria | Rust sidecar | C++ sidecar | Rust napi-rs addon | PowerShell (current) |
|----------|--------------|-------------|--------------------|-----------------------|
| Memory safety | ✅ | ⚠️ manual | ✅ | ✅ |
| Global hotkey **without Electron loaded** | ✅ | ✅ | ❌ needs Electron event loop | ❌ |
| In-process latency | Good | Good | ✅ best | ❌ |
| IPC to inject keys safely | ✅ named pipe + ACL | ✅ | N/A (same process) | ❌ |
| Cross-platform later | ✅ | ⚠️ rewrite | ⚠️ | ❌ |
| Installer size | +2–4 MB | +1–2 MB | +2 MB | 0 |

### Why not napi-rs (in-process addon)?

**Not because of Electron/Node version lock** — N-API (which napi-rs uses) is ABI-stable across Electron versions.

**Reject it because:** a Node addon only runs when Electron is loaded. If Ripple is minimized, crashed, or still starting, **no global hotkey handler exists**. P7 needs a process that is always alive independently.

napi-rs remains a **P7+ optimization** for sub-millisecond in-process calls after the sidecar API is proven.

### Verdict

> **Rust sidecar over named pipe.** Keep TypeScript exports in `electron/native/*`. PowerShell fallback until P7d is stable.

---

## 5. Architecture (end-to-end)

```
┌─────────────────────────────────────────────────────────────────┐
│  User presses Ctrl+Space (anywhere on Windows)                  │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  ripple-native.exe  (Rust sidecar)                              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  OS thread: Win32 message pump (GetMessage/DispatchMessage)│  │
│  │  • RegisterHotKey → WM_HOTKEY                           │  │
│  │  • SetWinEventHook(EVENT_SYSTEM_FOREGROUND)             │  │
│  └───────────────────────┬─────────────────────────────────┘  │
│                          │ mpsc channel                         │
│  ┌───────────────────────▼─────────────────────────────────┐  │
│  │  Worker: tokio or std::thread — IPC + SendInput + UIA   │  │
│  │  • Named pipe server (DACL: current user SID)            │  │
│  │  • Session token check on connect                       │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │  \\.\pipe\Ripple.Native.{pid}
                             │  + token in %LOCALAPPDATA%\Ripple\ripple-native.session
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Ripple Electron (main process)                                 │
│  • nativeClient.ts — connect pipe, auth handshake, call/events  │
│  • win32Bridge.ts — same public API, pipe first, PS fallback   │
│  • focusContext.ts — foreground_changed events                   │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
│  Voice → NLU → desktop actions (P4–P8)                          │

┌─────────────────────────────────────────────────────────────────┐
│  Chrome Extension ←──stdio──→ native-host.js ←──TCP──→ Electron │
│  (Gmail ingest, WhatsApp) — UNCHANGED, separate from P7         │
└─────────────────────────────────────────────────────────────────┘
```

### Process lifecycle

1. Electron spawns `ripple-native.exe` on `app.ready` (or installer registers auto-start later).
2. Sidecar writes session file: `%LOCALAPPDATA%\Ripple\ripple-native.session`  
   `{ "pipe": "\\\\.\\pipe\\Ripple.Native.12345", "token": "<random 32-byte hex>" }`
3. Electron reads session file, connects to named pipe, sends `auth` with token.
4. Sidecar validates token → returns version + protocol + capabilities → normal RPC + events.
5. Electron starts **health watchdog** — `ping` every 5s, 2s timeout (see §6.5).
6. On **crash, disconnect, or hang** → Electron kills sidecar if needed, respawns, re-auth, re-registers hotkeys (see §6.6).

### Crash recovery (automatic)

```
ripple-native.exe crashes OR pipe breaks OR ping times out
        ↓
Electron nativeWatchdog detects failure
        ↓
Kill stale ripple-native.exe (if process still alive but hung)
        ↓
Restart sidecar → new session file + token
        ↓
Reconnect → auth → get_capabilities
        ↓
Re-register hotkeys (register_hotkey)
        ↓
Resume foreground events
```

No user action required. PowerShell `win32Bridge` fallback remains active while sidecar is down.

---

## 6. IPC design (named pipe + auth)

### Why named pipe, not TCP

| | Named pipe | localhost TCP |
|---|------------|---------------|
| OS access control (DACL) | ✅ restrict to your user SID | ❌ any local process can connect |
| Touches network stack | No | Yes (loopback) |
| Fits keystroke injection | ✅ standard on Windows | ⚠️ needs custom auth |
| Chrome bridge pattern | Different component | Already used by `native-host.js` |

**Decision:** P7 OS layer uses **named pipes only**. Chrome `native-host` keeps TCP — different threat model (browser messaging, not SendInput).

### Security model (required before P7a ships)

The sidecar can **inject keystrokes** and **read foreground windows**. Treat IPC as a privileged local API.

**Layer 1 — Pipe DACL (honest scope)**

Windows pipe DACLs restrict by **user SID**, not by specific `.exe` identity. There is no standard ACL for “only Ripple.exe may connect.”

What v1 actually provides:

- Pipe + session file readable only by the **current Windows user** (not other users on the machine).
- Token handshake so casual cross-talk from unauthenticated clients on the same pipe is rejected.

What v1 does **not** provide:

- Protection against **other malware running as the same user** — it could read `ripple-native.session` and connect with the token.
- Process attestation / “only Electron” binding.

**Future (enterprise):** code-signing attestation, mutual TLS, or AppContainer — not v1.

**Layer 2 — Session token + version handshake**

On connect, before any other method:

```json
// Electron → native (first message after connect)
{ "id": "auth-1", "method": "auth", "params": { "token": "<from ripple-native.session>" } }

// native → Electron
{
  "id": "auth-1",
  "ok": true,
  "result": {
    "version": "0.1.0",
    "protocol": 1,
    "capabilities": {
      "sendInput": true,
      "uia": false,
      "ocr": false,
      "globalHotkey": true,
      "elevationInjection": false
    }
  }
}
```

- **Token:** 32 random bytes at sidecar start; written to session file with user-only ACL; rotated on restart.
- **Protocol:** integer (`protocol: 1`). Electron rejects unknown protocol versions with a clear error instead of failing mysteriously mid-call.
- **Version:** sidecar semver string for logging and support.
- Reject all other RPC methods until `auth` succeeds.

**Layer 3 — Single client (v1)**

- Only one connected Electron main process at a time.
- Second connection while first is alive → `error: "already_connected"`.
- **Stale connection recovery:** if the connected client crashes or the pipe breaks, the server **must** treat any failed `ReadFile` / `WriteFile` / broken pipe as disconnect, clear the client slot, and accept the next connection immediately. Without this, a force-killed Electron can deadlock all future connects on `already_connected`.

**Not in v1:** mutual TLS, code-signing attestation (enterprise hardening).

### Capability detection (`get_capabilities`)

Do not assume every feature exists at runtime. After `auth`, Electron calls `get_capabilities` (or uses the `capabilities` object from `auth`) and adapts:

```json
{
  "platform": "win32",
  "protocol": 1,
  "version": "0.1.0",
  "sendInput": true,
  "uia": false,
  "ocr": false,
  "globalHotkey": true,
  "elevationInjection": false,
  "foregroundEvents": true
}
```

Electron behavior examples:

- `sendInput: false` → keep PowerShell `sendKeys` fallback.
- `uia: false` → skip `get_focused_a11y` native path.
- `globalHotkey: false` → use Electron `globalShortcut` only.

Flags flip to `true` as P7b–P7f ship; no Electron code changes required per feature.

### §6.5 Health watchdog (liveness)

Process death is not the only failure mode — the sidecar can **hang** (e.g. pump thread deadlock) while the process stays alive and the pipe stays “connected.”

**Electron `nativeWatchdog.ts` (P7a):**

| Setting | Value |
|---------|-------|
| Interval | `ping` every **5 seconds** |
| Timeout | **2 seconds** per ping |
| On timeout | Treat sidecar as dead → kill process → respawn → re-auth → re-register hotkeys |
| On pipe error | Same recovery path |

Log: `[ripple-native] watchdog: ping timeout — restarting sidecar`

### §6.6 Stale client & sidecar recovery

| Event | Electron action |
|-------|-----------------|
| Pipe disconnect / write failure | Clear client state; respawn or reconnect |
| `ping` timeout | `taskkill` sidecar PID if hung; respawn |
| Sidecar exit code ≠ 0 | Auto-restart with backoff (max 30s) |
| After reconnect | `auth` → `get_capabilities` → `register_hotkey` for all bindings |

### Framing

Reuse **4-byte little-endian length prefix** + JSON body (same as `native-host.js`).

### Request / response / event

```json
{ "id": "req-uuid", "method": "get_foreground", "params": {} }
{ "id": "req-uuid", "ok": true, "result": { "hwnd": 12345678, "processName": "chrome", "windowTitle": "Gmail" } }
{ "event": "hotkey", "name": "voice" }
{ "event": "foreground_changed", "hwnd": 12345678, "processName": "explorer", "windowTitle": "Downloads" }
```

### Methods (P7a → P7e)

| Method | Phase | Notes |
|--------|-------|-------|
| `auth` | P7a | **Required first** — token from session file |
| `ping` | P7a | health check after auth |
| `get_capabilities` | P7a | feature flags — see §6; Electron adapts per flag |
| `register_hotkey` | P7b | `RegisterHotKey` only (see §7) |
| `unregister_hotkey` | P7b | |
| `get_foreground` | P7c | read cached HWND |
| `list_windows` | P7c | |
| `focus_window` | P7c | |
| `close_window` | P7c | |
| `minimize_all` | P7c | |
| `send_keys` | P7d | `SendInput` — may fail on elevated targets |
| `run_input_sequence` | P7d | |
| `get_focused_a11y` | P7e | COM / UIA |
| `screenshot_ocr` | P7f | optional WinRT OCR |

Session file: `%LOCALAPPDATA%\Ripple\ripple-native.session`  
(Pipe path + token — **not** a TCP port file.)

---

## 7. Runtime threading model (required design)

`RegisterHotKey` and `SetWinEventHook` deliver callbacks on the thread that registered them, via **`WM_HOTKEY`** / WinEvents inside a **`GetMessage` loop**. This does **not** compose with tokio's async runtime on the same thread.

### Two-thread model (implement in P7a)

```
Thread A — "win32_pump" (OS thread, blocks on GetMessage)
  • RegisterHotKey / SetWinEventHook
  • On WM_HOTKEY → send HotkeyEvent to channel
  • On foreground hook → send ForegroundEvent to channel

Thread B — "core" (tokio or std::thread)
  • Named pipe server + auth
  • Handle RPC: get_foreground, send_keys, UIA
  • Read from channel → push JSON events to connected Electron client
  • SendInput runs here (or dedicated short-lived thread if re-entrancy issues)
```

**Do not** put the message pump inside `tokio::main` without a dedicated `std::thread` — this is the most common P7 schedule slip (+1 week if discovered late).

### Hotkey implementation preference

| Approach | Use |
|----------|-----|
| **`RegisterHotKey`** | **Default** — Ctrl+Space, Alt+Shift+Space, Escape |
| `SetWindowsHookEx(WH_KEYBOARD_LL)` | **Last resort only** — AV/EDR flag as keylogger behavior |

Only add low-level hook if `RegisterHotKey` fails due to OS/app conflicts, and document the AV risk in release notes.

---

## 8. Elevation & UIPI (explicit scope)

Windows **User Interface Privilege Isolation (UIPI)** blocks a **non-elevated** process from sending input to an **elevated** window.

### v1 decision: **non-elevated sidecar, elevated targets out of scope**

| Target | P7 v1 behavior |
|--------|----------------|
| Notepad, Chrome, Excel (normal) | ✅ `SendInput` + UIA |
| Task Manager, admin PowerShell, UAC installers | ❌ silently fails or returns `error: "ui_elevation_blocked"` |
| Ripple itself | ✅ |

**Do not run `ripple-native.exe` elevated by default** — triggers UAC prompts, breaks drag-and-drop from Explorer, increases AV scrutiny.

### User-facing behavior

When injection fails due to UIPI:

```
"Can't type into that app — it's running as administrator. Open it normally or run Ripple as admin (not recommended)."
```

Log `ui_elevation_blocked` in telemetry for future decision.

### Future (P7+)

- Optional "elevated mode" with explicit user consent and separate signed binary — not v1.

---

## 9. Phased implementation

### P7a — Rust crate + named pipe + auth + message pump skeleton (Week 1–2)

**Goal:** Sidecar runs, Electron connects with token, `ping` works, pump thread alive.

**Create:**

```
ripple-desktop/ripple-native/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── win32_pump.rs       # Thread A: GetMessage loop
│   ├── ipc/
│   │   ├── mod.rs
│   │   ├── protocol.rs
│   │   ├── pipe_server.rs  # Thread B: named pipe + DACL
│   │   └── auth.rs
│   ├── session.rs          # write ripple-native.session
│   └── config.rs
└── README.md
```

**Rust crates:**

```toml
[dependencies]
windows = { version = "0.58", features = [
  "Win32_Foundation",
  "Win32_UI_WindowsAndMessaging",
  "Win32_System_Pipes",
  "Win32_Security",
] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["net", "io-util", "rt-multi-thread", "macros", "sync"] }
tracing = "0.1"
tracing-subscriber = "0.3"
uuid = { version = "1", features = ["v4"] }
rand = "0.8"
```

**Electron:**

- `nativeClient.ts` — read session file, connect `\\.\pipe\...`, `auth` then `call()`
- `nativeSpawn.ts` — spawn exe, wait for session file, kill stale process
- `nativeWatchdog.ts` — ping every 5s, 2s timeout, auto-restart (§6.5)
- `win32Bridge.ts` — pipe first; gate features on `get_capabilities`; PowerShell fallback

**Done when:**

```
[ripple-native] pipe listening, auth ok, protocol=1
[ripple-native] win32 pump thread started
[ripple-native] watchdog: ping ok
```

**Tests:**

- Reject connection without token
- Reject second client while first connected
- **Stale client:** kill Electron mid-session → restart connects (no `already_connected` deadlock)
- **Watchdog:** mock hung sidecar → Electron restarts within one timeout window
- `cargo test` + `phase-p7-native.spec.ts`

---

### P7b — Global hotkey via RegisterHotKey (Week 2–3)

**Goal:** Ctrl+Space fires when Ripple is minimized.

**Rust (win32_pump thread):**

- `RegisterHotKey` for Ctrl+Space, Alt+Shift+Space, Escape
- `WM_HOTKEY` → channel → pipe event to Electron

**Electron:**

- `hotkeyRegistry.ts` — subscribe to sidecar `hotkey` events
- Keep `globalShortcut` only if sidecar disconnected

**Done when:** voice overlay opens with Ripple minimized; **no** `WH_KEYBOARD_LL` in build.

---

### P7c — Foreground + window ops (Week 3–4)

**Goal:** Kill PowerShell polling in `focusContext.ts`.

**Rust:**

- `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` on pump thread
- Cache latest `ForegroundWindow` in shared state (atomic/arch mutex)
- RPC reads cache; pushes `foreground_changed` events

**Electron:**

- `focusContext.ts` — event-driven; 500ms PowerShell poll as fallback only

---

### P7d — Real SendInput (Week 4–6)

**Goal:** Reliable typing in normal (non-elevated) apps.

**Rust:**

- `SendInput` with `KEYEVENTF_UNICODE` for text
- Map existing `sendKeys` / `run_input_sequence` API
- Return `ui_elevation_blocked` when target HWND is elevated

**Electron:** existing `sendKeysNative` callers unchanged.

---

### P7e — UI Automation (Week 6–8)

**Goal:** Fast `get_focused_a11y` — replace PowerShell UIA.

**Rust:** `uiautomation` crate or direct `IUIAutomation` COM.

**Budget extra time here** if first Rust + COM project — most likely phase to slip.

---

### P7f — OCR + installer (optional, Week 8–10)

- `Windows.Media.Ocr` via WinRT
- Bundle `ripple-native.exe` in `electron-builder`
- Code signing for SmartScreen
- Optional Task Scheduler auto-start

---

## 10. How TypeScript uses it (no breaking changes)

```typescript
// electron/native/win32Bridge.ts

export async function getForegroundWindow(): Promise<ForegroundWindow | null> {
  if (await nativeClient.isAuthenticated()) {
    return nativeClient.call("get_foreground", {});
  }
  return getForegroundWindowPowerShell(); // fallback
}
```

Callers unchanged: `focusContext.ts`, `runDesktopAction.ts`, `nativeHost.ts`.

---

## 11. Folder layout

```
ripple-desktop/
├── docs/P7-NATIVE-LAYER-PLAN.md
├── electron/native/
│   ├── nativeClient.ts       # pipe + auth + capabilities
│   ├── nativeSpawn.ts        # spawn / kill / restart
│   ├── nativeWatchdog.ts     # ping liveness + auto-recovery
│   ├── win32Bridge.ts
│   ├── win32Bridge.ps.ts     # PowerShell fallback (extracted)
│   ├── hotkeyRegistry.ts
│   └── nativeHost.ts
├── ripple-native/            # Rust crate
└── native-host/              # Chrome bridge (TCP, unchanged)
```

---

## 12. Build & dev commands (planned)

```json
{
  "native:build": "cargo build --release --manifest-path ripple-native/Cargo.toml",
  "native:dev": "cargo run --manifest-path ripple-native/Cargo.toml",
  "dev": "concurrently \"npm run native:dev\" \"electron-vite dev\""
}
```

Release: `ripple-native/target/release/ripple-native.exe` → `resources/native/win32/`

---

## 13. Testing plan

| Test | Phase |
|------|-------|
| Auth rejects wrong token | P7a |
| Auth returns `protocol` + `version` + capability flags | P7a |
| Auth rejects second client while connected | P7a |
| Stale client: force-kill Electron → reconnect succeeds | P7a |
| Watchdog: ping timeout → sidecar restart | P7a |
| Crash recovery: kill sidecar → hotkeys re-registered | P7b |
| Pump thread receives WM_HOTKEY | P7b |
| Foreground event on alt-tab | P7c |
| SendInput Notepad (normal) | P7d |
| SendInput admin PowerShell → `ui_elevation_blocked` | P7d |
| UIA focused element &lt;50ms | P7e |
| Manual: hotkey with Ripple minimized | P7b |
| CI: `cargo test` on Windows runner | all |

---

## 14. Migration from PowerShell

| Step | Action |
|------|--------|
| 1 | P7a — pipe + auth + fallback |
| 2 | P7c — foreground events |
| 3 | P7d — SendInput |
| 4 | P7e — UIA |
| 5 | Remove PowerShell when fallback &lt;1% |

---

## 15. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **Unauthenticated IPC** | User-SID DACL + session token (§6) — blocks other users, not same-user malware |
| **Hung sidecar** | Watchdog ping 5s / 2s timeout → kill + respawn (§6.5) |
| **Stale pipe client** | Failed read/write clears slot — no `already_connected` deadlock (§6) |
| **UIPI / elevated apps** | Explicit out-of-scope + `ui_elevation_blocked` error (§8) |
| **AV flags keylogger** | `RegisterHotKey` default; avoid `WH_KEYBOARD_LL` (§7) |
| **Message pump + tokio** | Dedicated `win32_pump` thread (§7) |
| Unsigned `.exe` | Sign binary; install under `%LOCALAPPDATA%\Ripple\` |
| Hotkey conflicts | Configurable bindings in settings |
| Rust + Win32 learning curve | Budget **1.5–2×** timeline; P7e COM hardest |
| Two IPC channels | Chrome TCP (`native-bridge.port`) vs OS pipe (`ripple-native.session`) — document clearly |

---

## 16. Success metrics

| Metric | Before | After P7 |
|--------|--------|----------|
| Hotkey (Ripple minimized) | ~70% | **&gt;98%** |
| Foreground read latency | 200–800ms | **&lt;10ms** |
| PowerShell spawns/min | 60–120 | **0** |
| Same-user unauthorized connect | token required | **rejected without token** |
| Recovery after crash/hang | manual restart | **automatic** |
| SendInput (normal apps) | flaky | **&gt;90%** |

---

## 17. What P7 does NOT include

- macOS / Linux (Rust sidecar designed for later port)
- Typing into elevated / admin windows (v1)
- Replacing Chrome extension ingest
- P8 semantic memory
- Full Operator-class computer-use agent

---

## 18. Start checklist (do before coding)

- [ ] Install Rust: https://rustup.rs
- [ ] Read §6 (pipe + auth) and §7 (message pump) — **architecture locked**
- [ ] `cargo new ripple-native` under `ripple-desktop/`
- [ ] Implement session file + pipe DACL + `auth` method
- [ ] Implement `win32_pump` thread with empty `GetMessage` loop
- [ ] `nativeClient.ts` + `nativeWatchdog.ts` on `app.ready`
- [ ] Verify: wrong token rejected; stale-client reconnect works; ping timeout restarts sidecar
- [ ] Verify: `get_capabilities` gates features; PowerShell fallback when sidecar down
- [ ] P7b: `RegisterHotKey` on pump thread only
- [ ] Update `FINAL_IMPLEMENTATION_PLAN.md` when P7a ships

---

## 19. Decision record (rev 3)

| Decision | Choice |
|----------|--------|
| Language | **Rust** sidecar |
| IPC | **Named pipe** + user-SID DACL + session token |
| DACL scope | **Current user only** — not per-exe; same-user malware out of scope v1 |
| Not TCP for OS layer | Keystroke injection; pipe DACL is normal Windows local IPC |
| Stale client | Failed pipe I/O clears slot; next client accepted immediately |
| Liveness | Electron watchdog: **ping 5s, timeout 2s** → kill + respawn |
| Crash recovery | Auto: respawn → auth → capabilities → re-register hotkeys |
| Versioning | `auth` returns `version` + `protocol: 1` |
| Capabilities | `get_capabilities` feature flags; Electron adapts, no assumptions |
| Hotkey | **`RegisterHotKey`** default; no low-level hook in v1 |
| Threading | **Dedicated Win32 message pump thread** + IPC worker |
| Elevation | **Non-elevated sidecar**; admin targets out of scope v1 |
| napi-rs rejected because | Needs Electron loaded — not ABI instability |
| Chrome `native-host` | Unchanged (TCP) |
| Migration | Pipe first, PowerShell fallback until P7d stable |
| Enterprise hardening | Code-signing attestation — future, not v1 |

---

*Next step: **start P7a** — scaffold `ripple-native/` with pipe auth + message pump thread + `nativeClient.ts`.*
