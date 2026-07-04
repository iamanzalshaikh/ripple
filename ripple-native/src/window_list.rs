use crate::foreground;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct VisibleWindow {
    pub hwnd: i64,
    #[serde(rename = "processName")]
    pub process_name: String,
    #[serde(rename = "windowTitle")]
    pub window_title: String,
    #[serde(rename = "className")]
    pub class_name: String,
}

#[cfg(windows)]
pub fn list_visible_windows() -> Vec<VisibleWindow> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::sync::Mutex;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, IsWindowVisible,
    };

    static LIST: Mutex<Vec<VisibleWindow>> = Mutex::new(Vec::new());

    unsafe extern "system" fn enum_proc(hwnd: HWND, _: LPARAM) -> BOOL {
        if hwnd.0.is_null() {
            return BOOL(1);
        }
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let Some(snap) = foreground::snapshot_from_hwnd(hwnd) else {
            return BOOL(1);
        };
        if snap.window_title.trim().is_empty() {
            return BOOL(1);
        }

        let mut class_buf = [0u16; 256];
        let class_len = GetClassNameW(hwnd, &mut class_buf);
        let class_name = if class_len > 0 {
            OsString::from_wide(&class_buf[..class_len as usize])
                .to_string_lossy()
                .to_string()
        } else {
            String::new()
        };

        if let Ok(mut guard) = LIST.lock() {
            guard.push(VisibleWindow {
                hwnd: snap.hwnd,
                process_name: snap.process_name,
                window_title: snap.window_title,
                class_name,
            });
        }

        BOOL(1)
    }

    if let Ok(mut guard) = LIST.lock() {
        guard.clear();
    }

    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(0));
    }

    LIST.lock().map(|g| g.clone()).unwrap_or_default()
}

#[cfg(not(windows))]
pub fn list_visible_windows() -> Vec<VisibleWindow> {
    Vec::new()
}
