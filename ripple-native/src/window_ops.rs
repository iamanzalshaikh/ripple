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

#[derive(Debug, serde::Deserialize)]
pub struct PreSendStateParams {
    pub hwnd: Option<i64>,
}

#[derive(Debug, serde::Serialize, Default)]
pub struct PreSendState {
    pub win: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub visible: bool,
    pub iconic: bool,
    #[serde(rename = "fgHwnd")]
    pub fg_hwnd: i64,
    #[serde(rename = "fgProc")]
    pub fg_proc: String,
}

/// Read-only pre-send probe: modifier-key state plus the target window's
/// reachability. Identical data to the PowerShell `preSendState` action, but
/// over the pipe instead of a process spawn — that spawn measured ~639 ms and
/// ran on every insert, which made it the largest remaining cost in
/// compose to paste. No behaviour change: the gates consume the same fields.
#[cfg(windows)]
pub fn get_pre_send_state(params: &PreSendStateParams) -> Result<PreSendState, String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsIconic, IsWindowVisible,
    };

    unsafe {
        // High-order bit set means the key is currently down.
        let down = |vk: VIRTUAL_KEY| (GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000) != 0;

        let fg = GetForegroundWindow();
        let mut state = PreSendState {
            win: down(VK_LWIN) || down(VK_RWIN),
            ctrl: down(VK_CONTROL),
            shift: down(VK_SHIFT),
            alt: down(VK_MENU),
            fg_hwnd: fg.0 as isize as i64,
            ..Default::default()
        };

        if let Some(raw) = params.hwnd.filter(|h| *h != 0) {
            let hwnd = HWND(raw as isize as *mut _);
            state.visible = IsWindowVisible(hwnd).as_bool();
            state.iconic = IsIconic(hwnd).as_bool();
        }

        if let Some(snap) = crate::foreground::get_cached() {
            if snap.hwnd == state.fg_hwnd {
                state.fg_proc = snap.process_name.clone();
            }
        }

        Ok(state)
    }
}

#[cfg(not(windows))]
pub fn get_pre_send_state(_params: &PreSendStateParams) -> Result<PreSendState, String> {
    Err("pre_send_state requires Windows".to_string())
}
