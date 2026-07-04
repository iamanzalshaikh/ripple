# ripple-native (P7 sidecar)

Windows native helper for Ripple Desktop — named pipe IPC, global hotkeys, SendInput, UIA.

## Prerequisites

Install Rust: https://rustup.rs

```powershell
rustup default stable
```

## Build

```powershell
cd ripple-desktop
npm run native:build
```

Debug binary: `ripple-native/target/debug/ripple-native.exe`

## Run standalone (dev)

```powershell
cargo run --manifest-path ripple-native/Cargo.toml
```

Writes `%LOCALAPPDATA%\Ripple\ripple-native.session` with pipe path + auth token.
