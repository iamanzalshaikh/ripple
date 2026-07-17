use crate::events::NativeEvent;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::broadcast;

static GLOBAL_HOTKEYS_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn global_hotkeys_active() -> bool {
    GLOBAL_HOTKEYS_ACTIVE.load(Ordering::Relaxed)
}

pub fn start(event_tx: broadcast::Sender<NativeEvent>) {
    std::thread::Builder::new()
        .name("ripple-win32-pump".into())
        .spawn(move || {
            if let Err(e) = run_message_loop(event_tx) {
                tracing::error!("win32 pump failed: {e}");
            }
        })
        .expect("spawn win32 pump thread");
}

#[cfg(windows)]
fn run_message_loop(event_tx: broadcast::Sender<NativeEvent>) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
        TranslateMessage, HMENU, MSG, WINDOW_EX_STYLE,
        WM_HOTKEY, WNDCLASSW, WS_OVERLAPPED, HWND_MESSAGE,
    };

    const HOTKEY_VOICE: i32 = 1;
    const HOTKEY_DICTATION: i32 = 2;
    const HOTKEY_DICTATION_ALT: i32 = 4;
    const HOTKEY_CANCEL: i32 = 3;

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    unsafe {
        let class_name = wide("RippleNativeHotkeyWindow");
        let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?;

        let wc = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance.into(),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };
        RegisterClassW(&wc);

        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(wide("RippleNative").as_ptr()),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            HMENU(std::ptr::null_mut()),
            instance,
            None,
        )
        .map_err(|e| e.to_string())?;

        let fg_hook = match crate::foreground::install_foreground_hook(event_tx.clone()) {
            Ok(h) => Some(h),
            Err(e) => {
                tracing::warn!(
                    "foreground hook unavailable ({e}) — hotkeys + RPC still active"
                );
                None
            }
        };

        const MOD_ALT: u32 = 0x0001;
        const MOD_CONTROL: u32 = 0x0002;
        const MOD_SHIFT: u32 = 0x0004;
        const MOD_NOREPEAT: u32 = 0x4000;
        const VK_SPACE: u32 = 0x20;
        const VK_ESCAPE: u32 = 0x1B;

        let hotkeys = [
            (
                HOTKEY_VOICE,
                HOT_KEY_MODIFIERS(MOD_CONTROL | MOD_NOREPEAT),
                VK_SPACE,
                "Ctrl+Space=command",
            ),
            (
                HOTKEY_DICTATION,
                HOT_KEY_MODIFIERS(MOD_ALT | MOD_NOREPEAT),
                VK_SPACE,
                "Alt+Space=dictation",
            ),
            (
                HOTKEY_DICTATION_ALT,
                HOT_KEY_MODIFIERS(MOD_ALT | MOD_SHIFT | MOD_NOREPEAT),
                VK_SPACE,
                "Alt+Shift+Space=dictation",
            ),
            (
                HOTKEY_CANCEL,
                HOT_KEY_MODIFIERS(MOD_NOREPEAT),
                VK_ESCAPE,
                "Esc=cancel",
            ),
        ];

        let mut registered_hotkeys: Vec<i32> = Vec::new();
        for (id, modifiers, vk, label) in hotkeys.iter().copied() {
            match RegisterHotKey(hwnd, id, modifiers, vk) {
                Ok(()) => registered_hotkeys.push(id),
                Err(e) => {
                    tracing::warn!(
                        "win32 pump: RegisterHotKey unavailable for {label}: {e}; Electron fallback may handle hotkeys"
                    );
                    for registered_id in registered_hotkeys.drain(..) {
                        let _ = UnregisterHotKey(hwnd, registered_id);
                    }
                    GLOBAL_HOTKEYS_ACTIVE.store(false, Ordering::Relaxed);
                    break;
                }
            }
        }

        if registered_hotkeys.len() == hotkeys.len() {
            GLOBAL_HOTKEYS_ACTIVE.store(true, Ordering::Relaxed);
            tracing::info!(
                "win32 pump: RegisterHotKey ready (Ctrl+Space=command, Alt+Space=dictation, Esc=cancel)"
            );
        }

        let mut msg = MSG::default();
        loop {
            let ret = GetMessageW(&mut msg, hwnd, 0, 0);
            if !ret.as_bool() {
                break;
            }

            if msg.message == WM_HOTKEY {
                let name = match msg.wParam.0 as i32 {
                    HOTKEY_VOICE => "command",
                    HOTKEY_DICTATION | HOTKEY_DICTATION_ALT => "dictation",
                    HOTKEY_CANCEL => "cancel_voice",
                    _ => continue,
                };
                let _ = event_tx.send(NativeEvent::Hotkey {
                    name: name.to_string(),
                });
            }

            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        if let Some(fg_hook) = fg_hook {
            crate::foreground::uninstall_foreground_hook(fg_hook);
        }
        GLOBAL_HOTKEYS_ACTIVE.store(false, Ordering::Relaxed);
        for registered_id in registered_hotkeys {
            let _ = UnregisterHotKey(hwnd, registered_id);
        }
    }

    tracing::info!("win32 pump thread exiting");
    Ok(())
}

#[cfg(not(windows))]
fn run_message_loop(_event_tx: broadcast::Sender<NativeEvent>) -> Result<(), String> {
    Err("windows only".into())
}
