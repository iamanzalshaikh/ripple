use crate::events::{ForegroundSnapshot, NativeEvent};
use std::sync::{Mutex, OnceLock};
use tokio::sync::broadcast;

static CACHE: OnceLock<Mutex<Option<ForegroundSnapshot>>> = OnceLock::new();
static HOOK_TX: OnceLock<broadcast::Sender<NativeEvent>> = OnceLock::new();

fn cache() -> &'static Mutex<Option<ForegroundSnapshot>> {
    CACHE.get_or_init(|| Mutex::new(None))
}

pub fn get_cached() -> Option<ForegroundSnapshot> {
    cache().lock().ok()?.clone()
}

pub fn update_cache(snap: &ForegroundSnapshot) {
    if let Ok(mut guard) = cache().lock() {
        *guard = Some(snap.clone());
    }
}

#[cfg(windows)]
pub fn read_current_foreground() -> Option<ForegroundSnapshot> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        snapshot_from_hwnd(hwnd)
    }
}

#[cfg(not(windows))]
pub fn read_current_foreground() -> Option<ForegroundSnapshot> {
    None
}

#[cfg(windows)]
pub fn snapshot_from_hwnd(hwnd: windows::Win32::Foundation::HWND) -> Option<ForegroundSnapshot> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::ProcessStatus::{K32GetModuleBaseNameW, K32GetProcessImageFileNameW};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextW, GetWindowThreadProcessId};

    unsafe {
        if hwnd.0.is_null() {
            return None;
        }

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let window_title = if title_len > 0 {
            OsString::from_wide(&title_buf[..title_len as usize])
                .to_string_lossy()
                .chars()
                .filter(|c| !c.is_control())
                .collect::<String>()
                .trim()
                .to_string()
        } else {
            String::new()
        };

        let mut pid = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));

        let process_name = if pid != 0 {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if let Ok(handle) = handle {
                let mut name_buf = [0u16; 260];
                let len = K32GetModuleBaseNameW(handle, None, &mut name_buf);
                let mut name = if len > 0 {
                    OsString::from_wide(&name_buf[..len as usize])
                        .to_string_lossy()
                        .to_string()
                } else {
                    String::new()
                };
                if name.is_empty() {
                    let mut path_buf = [0u16; 1024];
                    let path_len =
                        K32GetProcessImageFileNameW(handle, &mut path_buf);
                    if path_len > 0 {
                        let path = OsString::from_wide(&path_buf[..path_len as usize])
                            .to_string_lossy()
                            .to_string();
                        name = path
                            .rsplit(['\\', '/'])
                            .next()
                            .unwrap_or(&path)
                            .trim_end_matches(".exe")
                            .to_string();
                    }
                }
                let _ = CloseHandle(handle);
                name
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        Some(ForegroundSnapshot {
            hwnd: hwnd.0 as i64,
            process_name,
            window_title,
        })
    }
}

#[cfg(windows)]
unsafe extern "system" fn winevent_proc(
    _hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK,
    event: u32,
    hwnd: windows::Win32::Foundation::HWND,
    _id_object: i32,
    _id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    use windows::Win32::UI::WindowsAndMessaging::EVENT_SYSTEM_FOREGROUND;

    if event != EVENT_SYSTEM_FOREGROUND {
        return;
    }
    let Some(snap) = snapshot_from_hwnd(hwnd) else {
        return;
    };
    update_cache(&snap);
    if let Some(tx) = HOOK_TX.get() {
        let _ = tx.send(snap.to_native_event());
    }
}

#[cfg(windows)]
pub unsafe fn install_foreground_hook(
    event_tx: broadcast::Sender<NativeEvent>,
) -> Result<windows::Win32::UI::Accessibility::HWINEVENTHOOK, String> {
    use windows::Win32::Foundation::GetLastError;
    use windows::Win32::UI::Accessibility::SetWinEventHook;
    use windows::Win32::UI::WindowsAndMessaging::EVENT_SYSTEM_FOREGROUND;

    let _ = HOOK_TX.set(event_tx.clone());

    let hook = SetWinEventHook(
        EVENT_SYSTEM_FOREGROUND,
        EVENT_SYSTEM_FOREGROUND,
        None,
        Some(winevent_proc),
        0,
        0,
        0, // WINEVENT_OUTOFCONTEXT — works across threads; pump stays alive for hotkeys
    );

    if hook.is_invalid() {
        let err = GetLastError();
        return Err(format!("SetWinEventHook failed: {err:?}"));
    }

    tracing::info!("win32 pump: SetWinEventHook(EVENT_SYSTEM_FOREGROUND) ready");

    if let Some(snap) = read_current_foreground() {
        update_cache(&snap);
        let _ = event_tx.send(snap.to_native_event());
    }

    Ok(hook)
}

#[cfg(windows)]
pub unsafe fn uninstall_foreground_hook(hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK) {
    use windows::Win32::UI::Accessibility::UnhookWinEvent;
    let _ = UnhookWinEvent(hook);
}
