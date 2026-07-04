use crate::elevation::is_hwnd_elevated;
use crate::send_input::focus_hwnd;

#[derive(Debug, serde::Deserialize)]
pub struct FocusWindowParams {
    pub hwnd: i64,
    #[serde(rename = "titleHint")]
    pub title_hint: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct CloseWindowParams {
    pub hwnd: i64,
}

#[derive(Debug, serde::Serialize)]
pub struct WindowOpResult {
    pub ok: bool,
    pub hwnd: i64,
}

#[derive(Debug, serde::Deserialize)]
pub struct WindowRectParams {
    pub hwnd: i64,
}

#[derive(Debug, serde::Serialize)]
pub struct WindowRectResult {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    #[serde(rename = "centerX")]
    pub center_x: i32,
    #[serde(rename = "centerY")]
    pub center_y: i32,
}

pub fn get_window_rect(params: &WindowRectParams) -> Result<WindowRectResult, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

        if params.hwnd == 0 {
            return Err("invalid_hwnd".into());
        }
        let hwnd = HWND(params.hwnd as _);
        let mut rect = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut rect).map_err(|e| format!("get_window_rect:{e}"))?;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        Ok(WindowRectResult {
            x: rect.left,
            y: rect.top,
            width,
            height,
            center_x: rect.left + width / 2,
            center_y: rect.top + height / 2,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = params;
        Err("windows only".into())
    }
}

pub fn focus_window(params: &FocusWindowParams) -> Result<WindowOpResult, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        if params.hwnd == 0 {
            return Err("invalid_hwnd".into());
        }
        let hwnd = HWND(params.hwnd as _);
        if is_hwnd_elevated(hwnd) {
            return Err("ui_elevation_blocked".into());
        }
        focus_hwnd(hwnd, params.title_hint.as_deref())?;
        Ok(WindowOpResult {
            ok: true,
            hwnd: params.hwnd,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = params;
        Err("windows only".into())
    }
}

pub fn close_window(params: &CloseWindowParams) -> Result<WindowOpResult, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::SendMessageW;

        if params.hwnd == 0 {
            return Err("invalid_hwnd".into());
        }
        let hwnd = HWND(params.hwnd as _);
        if is_hwnd_elevated(hwnd) {
            return Err("ui_elevation_blocked".into());
        }
        unsafe {
            SendMessageW(
                hwnd,
                windows::Win32::UI::WindowsAndMessaging::WM_CLOSE,
                WPARAM(0),
                LPARAM(0),
            );
        }
        Ok(WindowOpResult {
            ok: true,
            hwnd: params.hwnd,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = params;
        Err("windows only".into())
    }
}
