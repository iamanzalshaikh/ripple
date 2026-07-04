use crate::elevation::is_hwnd_elevated;

#[derive(Debug, serde::Deserialize)]
pub struct MouseClickParams {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub button: Option<String>,
    #[serde(default)]
    pub double: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub struct MouseScrollParams {
    pub x: i32,
    pub y: i32,
    pub delta: i32,
    #[serde(default)]
    pub horizontal: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub struct MouseDragParams {
    #[serde(rename = "fromX")]
    pub from_x: i32,
    #[serde(rename = "fromY")]
    pub from_y: i32,
    #[serde(rename = "toX")]
    pub to_x: i32,
    #[serde(rename = "toY")]
    pub to_y: i32,
    #[serde(default)]
    pub button: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct MouseMoveParams {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, serde::Serialize)]
pub struct MouseResult {
    pub ok: bool,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, serde::Serialize)]
pub struct CursorPosition {
    pub ok: bool,
    pub x: i32,
    pub y: i32,
}

pub fn mouse_move(params: &MouseMoveParams) -> Result<MouseResult, String> {
    move_pointer(params.x, params.y)?;
    Ok(MouseResult {
        ok: true,
        x: params.x,
        y: params.y,
    })
}

pub fn get_cursor_position() -> Result<CursorPosition, String> {
    let (x, y) = read_cursor_position()?;
    Ok(CursorPosition { ok: true, x, y })
}

pub fn mouse_click(params: &MouseClickParams) -> Result<MouseResult, String> {
    move_pointer(params.x, params.y)?;
    let down = button_down_flags(&params.button);
    let up = button_up_flags(&params.button);
    send_mouse_flags(down)?;
    send_mouse_flags(up)?;
    if params.double.unwrap_or(false) {
        std::thread::sleep(std::time::Duration::from_millis(50));
        send_mouse_flags(down)?;
        send_mouse_flags(up)?;
    }
    Ok(MouseResult {
        ok: true,
        x: params.x,
        y: params.y,
    })
}

pub fn mouse_scroll(params: &MouseScrollParams) -> Result<MouseResult, String> {
    move_pointer(params.x, params.y)?;
    let horizontal = params.horizontal.unwrap_or(false);
    let delta = params.delta.clamp(-1200, 1200);
    let flags = if horizontal {
        MOUSEEVENTF_HWHEEL
    } else {
        MOUSEEVENTF_WHEEL
    };
    send_mouse_wheel(flags, delta as i16)?;
    Ok(MouseResult {
        ok: true,
        x: params.x,
        y: params.y,
    })
}

pub fn mouse_drag(params: &MouseDragParams) -> Result<MouseResult, String> {
    move_pointer(params.from_x, params.from_y)?;
    let down = button_down_flags(&params.button);
    let up = button_up_flags(&params.button);
    send_mouse_flags(down)?;
    std::thread::sleep(std::time::Duration::from_millis(30));
    move_pointer(params.to_x, params.to_y)?;
    std::thread::sleep(std::time::Duration::from_millis(30));
    send_mouse_flags(up)?;
    Ok(MouseResult {
        ok: true,
        x: params.to_x,
        y: params.to_y,
    })
}

#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK,
    MOUSEEVENTF_WHEEL, MOUSEINPUT,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN, WindowFromPoint,
};
#[cfg(windows)]
use windows::Win32::Foundation::POINT;

#[cfg(windows)]
fn to_absolute(x: i32, y: i32) -> (i32, i32) {
    let vx = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let vy = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let vw = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1) };
    let vh = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1) };
    let ax = (((x - vx) as i64 * 65535) / vw as i64) as i32;
    let ay = (((y - vy) as i64 * 65535) / vh as i64) as i32;
    (ax, ay)
}

#[cfg(windows)]
fn ensure_mouse_injectable_at(x: i32, y: i32) -> Result<(), String> {
    let pt = POINT { x, y };
    unsafe {
        let hwnd = WindowFromPoint(pt);
        if !hwnd.0.is_null() && is_hwnd_elevated(hwnd) {
            return Err("ui_elevation_blocked".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
fn read_cursor_position() -> Result<(i32, i32), String> {
    let mut pt = POINT::default();
    unsafe {
        GetCursorPos(&mut pt).map_err(|_| "get_cursor_pos_failed".to_string())?;
    }
    Ok((pt.x, pt.y))
}

#[cfg(not(windows))]
fn read_cursor_position() -> Result<(i32, i32), String> {
    Err("windows only".into())
}

#[cfg(windows)]
fn move_pointer(x: i32, y: i32) -> Result<(), String> {
    ensure_mouse_injectable_at(x, y)?;
    let (ax, ay) = to_absolute(x, y);
    let flags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    send_mouse_input(flags, ax, ay, 0)
}

#[cfg(windows)]
fn send_mouse_flags(flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS) -> Result<(), String> {
    send_mouse_input(flags, 0, 0, 0)
}

#[cfg(windows)]
fn send_mouse_wheel(
    flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS,
    delta: i16,
) -> Result<(), String> {
    send_mouse_input(flags, 0, 0, delta as i32)
}

#[cfg(windows)]
fn send_mouse_input(
    flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS,
    dx: i32,
    dy: i32,
    data: i32,
) -> Result<(), String> {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        let sent = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        if sent != 1 {
            return Err("mouse_sendinput_failed".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
fn button_down_flags(button: &Option<String>) -> windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS {
    let b = button.as_deref().unwrap_or("left").to_ascii_lowercase();
    match b.as_str() {
        "right" => MOUSEEVENTF_RIGHTDOWN,
        "middle" => MOUSEEVENTF_MIDDLEDOWN,
        _ => MOUSEEVENTF_LEFTDOWN,
    }
}

#[cfg(windows)]
fn button_up_flags(button: &Option<String>) -> windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS {
    let b = button.as_deref().unwrap_or("left").to_ascii_lowercase();
    match b.as_str() {
        "right" => MOUSEEVENTF_RIGHTUP,
        "middle" => MOUSEEVENTF_MIDDLEUP,
        _ => MOUSEEVENTF_LEFTUP,
    }
}

#[cfg(not(windows))]
fn move_pointer(_x: i32, _y: i32) -> Result<(), String> {
    Err("windows only".into())
}

#[cfg(not(windows))]
pub fn mouse_move(_params: &MouseMoveParams) -> Result<MouseResult, String> {
    Err("windows only".into())
}

#[cfg(not(windows))]
pub fn get_cursor_position() -> Result<CursorPosition, String> {
    Err("windows only".into())
}

#[cfg(not(windows))]
pub fn mouse_click(_params: &MouseClickParams) -> Result<MouseResult, String> {
    Err("windows only".into())
}

#[cfg(not(windows))]
pub fn mouse_scroll(_params: &MouseScrollParams) -> Result<MouseResult, String> {
    Err("windows only".into())
}

#[cfg(not(windows))]
pub fn mouse_drag(_params: &MouseDragParams) -> Result<MouseResult, String> {
    Err("windows only".into())
}
