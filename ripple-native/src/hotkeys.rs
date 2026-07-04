use crate::events::NativeEvent;
use tokio::sync::broadcast;

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
    const HOTKEY_VOICE_ALT: i32 = 2;
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

        RegisterHotKey(
            hwnd,
            HOTKEY_VOICE,
            HOT_KEY_MODIFIERS(MOD_CONTROL | MOD_NOREPEAT),
            VK_SPACE,
        )
        .map_err(|e| e.to_string())?;
        RegisterHotKey(
            hwnd,
            HOTKEY_VOICE_ALT,
            HOT_KEY_MODIFIERS(MOD_ALT | MOD_SHIFT | MOD_NOREPEAT),
            VK_SPACE,
        )
        .map_err(|e| e.to_string())?;
        RegisterHotKey(
            hwnd,
            HOTKEY_CANCEL,
            HOT_KEY_MODIFIERS(MOD_NOREPEAT),
            VK_ESCAPE,
        )
        .map_err(|e| e.to_string())?;

        tracing::info!("win32 pump: RegisterHotKey ready (Ctrl+Space, Alt+Shift+Space, Escape)");

        let mut msg = MSG::default();
        loop {
            let ret = GetMessageW(&mut msg, hwnd, 0, 0);
            if !ret.as_bool() {
                break;
            }

            if msg.message == WM_HOTKEY {
                let name = match msg.wParam.0 as i32 {
                    HOTKEY_VOICE | HOTKEY_VOICE_ALT => "voice",
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
        let _ = UnregisterHotKey(hwnd, HOTKEY_VOICE);
        let _ = UnregisterHotKey(hwnd, HOTKEY_VOICE_ALT);
        let _ = UnregisterHotKey(hwnd, HOTKEY_CANCEL);
    }

    tracing::info!("win32 pump thread exiting");
    Ok(())
}

#[cfg(not(windows))]
fn run_message_loop(_event_tx: broadcast::Sender<NativeEvent>) -> Result<(), String> {
    Err("windows only".into())
}
