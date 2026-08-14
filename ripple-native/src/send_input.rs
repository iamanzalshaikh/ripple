use crate::elevation::is_hwnd_elevated;
use crate::foreground::read_current_foreground;

#[derive(Debug, serde::Serialize)]
pub struct InputResult {
    pub ok: bool,
    #[serde(rename = "foregroundHwnd")]
    pub foreground_hwnd: i64,
    #[serde(rename = "foregroundTitle")]
    pub foreground_title: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct SendKeysParams {
    pub hwnd: Option<i64>,
    #[serde(rename = "titleHint")]
    pub title_hint: Option<String>,
    pub text: Option<String>,
    pub keys: Option<String>,
    #[serde(rename = "delayMs")]
    pub delay_ms: Option<u64>,
}

#[derive(Debug, serde::Deserialize)]
pub struct InputStep {
    #[serde(rename = "type")]
    pub step_type: String,
    pub value: String,
    #[serde(rename = "delayMs")]
    pub delay_ms: Option<u64>,
}

#[derive(Debug, serde::Deserialize)]
pub struct RunSequenceParams {
    pub hwnd: Option<i64>,
    #[serde(rename = "titleHint")]
    pub title_hint: Option<String>,
    #[serde(rename = "delayMs")]
    pub delay_ms: Option<u64>,
    pub steps: Vec<InputStep>,
}

pub fn send_keys(params: &SendKeysParams) -> Result<InputResult, String> {
    if let Some(ms) = params.delay_ms {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }

    let target_hwnd = resolve_target_hwnd(params.hwnd)?;
    ensure_injectable(target_hwnd)?;

    if let Some(hwnd) = target_hwnd {
        focus_hwnd(hwnd, params.title_hint.as_deref())?;
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    if let Some(text) = &params.text {
        if !text.is_empty() {
            send_unicode_text(text)?;
        }
    }

    if let Some(keys) = &params.keys {
        if !keys.is_empty() {
            send_keys_tokens(keys)?;
        }
    }

    result_after_input(target_hwnd)
}

pub fn run_input_sequence(params: &RunSequenceParams) -> Result<InputResult, String> {
    if let Some(ms) = params.delay_ms {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }

    let target_hwnd = resolve_target_hwnd(params.hwnd)?;
    ensure_injectable(target_hwnd)?;

    if let Some(hwnd) = target_hwnd {
        focus_hwnd(hwnd, params.title_hint.as_deref())?;
        std::thread::sleep(std::time::Duration::from_millis(300));
    }

    for step in &params.steps {
        match step.step_type.as_str() {
            "text" => {
                if !step.value.is_empty() {
                    send_unicode_text(&step.value)?;
                }
            }
            "keys" => {
                if !step.value.is_empty() {
                    send_keys_tokens(&step.value)?;
                }
            }
            other => return Err(format!("unknown_step_type:{other}")),
        }
        if let Some(ms) = step.delay_ms {
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
    }

    result_after_input(target_hwnd)
}

fn resolve_target_hwnd(hwnd: Option<i64>) -> Result<Option<windows::Win32::Foundation::HWND>, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        if let Some(raw) = hwnd {
            if raw != 0 {
                return Ok(Some(HWND(raw as _)));
            }
        }
        Ok(None)
    }
    #[cfg(not(windows))]
    {
        let _ = hwnd;
        Err("windows only".into())
    }
}

fn ensure_injectable(hwnd: Option<windows::Win32::Foundation::HWND>) -> Result<(), String> {
    #[cfg(windows)]
    {
        if let Some(h) = hwnd {
            if is_hwnd_elevated(h) {
                return Err("ui_elevation_blocked".into());
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = hwnd;
        Err("windows only".into())
    }
}

fn result_after_input(
    target_hwnd: Option<windows::Win32::Foundation::HWND>,
) -> Result<InputResult, String> {
    let fg = read_current_foreground().ok_or_else(|| "no_foreground".to_string())?;
    let ok = match target_hwnd {
        Some(hwnd) => fg.hwnd == hwnd.0 as i64,
        None => true,
    };
    Ok(InputResult {
        ok,
        foreground_hwnd: fg.hwnd,
        foreground_title: fg.window_title,
    })
}

#[cfg(windows)]
fn foreground_is_desktop_shell() -> bool {
    let Some(fg) = read_current_foreground() else {
        return false;
    };
    if !fg.process_name.eq_ignore_ascii_case("explorer") {
        return false;
    }
    let title = fg.window_title.trim();
    title.is_empty() || title.eq_ignore_ascii_case("Program Manager")
}

/// ASFW_ANY — only works while this process still holds the FG lock
/// (hotkey / simulated input). Harmless no-op otherwise.
#[cfg(windows)]
pub fn allow_set_foreground_any() {
    use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;
    unsafe {
        let _ = AllowSetForegroundWindow(0xFFFF_FFFF);
    }
}

/// Lock/unlock SetForegroundWindow so explorer cannot steal FG mid-restore.
#[cfg(windows)]
pub fn lock_set_foreground(lock: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        LockSetForegroundWindow, LSFW_LOCK, LSFW_UNLOCK,
    };
    unsafe {
        let _ = LockSetForegroundWindow(if lock { LSFW_LOCK } else { LSFW_UNLOCK });
    }
}

#[cfg(windows)]
fn synthetic_alt_tap() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU,
    };
    unsafe {
        keybd_event(VK_MENU.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}

#[cfg(windows)]
pub fn grant_foreground_permission() {
    allow_set_foreground_any();
    // Hotkey path: unlock so we can hand FG to the target app.
    lock_set_foreground(false);
    // Alt tap re-grants SetForegroundWindow rights. Skip when the desktop
    // already holds FG — Alt then selects a desktop icon (Program Manager).
    if !foreground_is_desktop_shell() {
        synthetic_alt_tap();
    }
}

#[cfg(not(windows))]
pub fn grant_foreground_permission() {}

#[cfg(not(windows))]
pub fn allow_set_foreground_any() {}

#[cfg(not(windows))]
pub fn lock_set_foreground(_lock: bool) {}

#[cfg(windows)]
pub fn focus_hwnd(hwnd: windows::Win32::Foundation::HWND, _title_hint: Option<&str>) -> Result<(), String> {
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
        SetForegroundWindow, ShowWindow, SwitchToThisWindow, SW_RESTORE, SW_SHOW,
    };

    unsafe {
        if hwnd.0.is_null() {
            return Err("invalid_hwnd".into());
        }

        // Already foreground: leave it alone. The Alt tap + AttachThreadInput
        // ritual on an already-foreground Chrome flips it into Alt-menu
        // mnemonic mode, which swallows the next Ctrl+V (failed-paste bug).
        if GetForegroundWindow() == hwnd {
            return Ok(());
        }

        let shell_fg = foreground_is_desktop_shell();
        allow_set_foreground_any();
        // Alt-while-desktop-FG selects a desktop ListItem — never do that here.
        // Do not LockSetForegroundWindow here: restoreFocusContext holds that
        // lock around the whole retry loop; nested unlock would drop it.
        if !shell_fg {
            synthetic_alt_tap();
        }

        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        let _ = BringWindowToTop(hwnd);
        SwitchToThisWindow(hwnd, true);

        let fg = GetForegroundWindow();
        let mut fg_pid = 0u32;
        let our_thread = GetCurrentThreadId();
        let fg_thread = GetWindowThreadProcessId(fg, Some(&mut fg_pid));
        let attached = fg_thread != 0 && fg_thread != our_thread && AttachThreadInput(our_thread, fg_thread, true).as_bool();

        let _ = BringWindowToTop(hwnd);
        let _ = SetForegroundWindow(hwnd);
        SwitchToThisWindow(hwnd, true);

        if attached {
            let _ = AttachThreadInput(our_thread, fg_thread, false);
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn focus_hwnd(_hwnd: (), _title_hint: Option<&str>) -> Result<(), String> {
    Err("windows only".into())
}

#[cfg(windows)]
pub fn send_unicode_text(text: &str) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
        VIRTUAL_KEY,
    };

    for unit in text.encode_utf16() {
        let down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let up = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        unsafe {
            let sent = SendInput(&[down, up], std::mem::size_of::<INPUT>() as i32);
            if sent != 2 {
                return Err("sendinput_unicode_failed".into());
            }
        }
        // W1 insert-matrix: 8ms/char raced Windows' own autocorrect/text-prediction
        // at word boundaries (space), which intercepted and substituted whole words
        // with placeholder characters — reproduced live in Notepad ("world" -> spaces,
        // "flow test." -> dots). 20ms clears the race in testing.
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn send_unicode_text(_text: &str) -> Result<(), String> {
    Err("windows only".into())
}

#[cfg(windows)]
pub fn send_keys_tokens(raw: &str) -> Result<(), String> {
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        match c {
            '^' => {
                ctrl = true;
                i += 1;
            }
            '%' => {
                alt = true;
                i += 1;
            }
            '+' => {
                shift = true;
                i += 1;
            }
            '{' => {
                let end = chars[i..]
                    .iter()
                    .position(|ch| *ch == '}')
                    .ok_or_else(|| "bad_sendkeys_token".to_string())?;
                let token: String = chars[i + 1..i + end].iter().collect();
                i += end + 1;
                if token.len() == 1 {
                    tap_char(token.chars().next().unwrap(), ctrl, alt, shift)?;
                } else {
                    tap_special_key(&token, ctrl, alt, shift)?;
                }
                ctrl = false;
                alt = false;
                shift = false;
            }
            ch => {
                tap_char(ch, ctrl, alt, shift)?;
                ctrl = false;
                alt = false;
                shift = false;
                i += 1;
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn send_keys_tokens(_raw: &str) -> Result<(), String> {
    Err("windows only".into())
}

#[cfg(windows)]
fn tap_char(ch: char, ctrl: bool, alt: bool, shift: bool) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_SHIFT, VK_CONTROL, VK_MENU,
    };

    let vk = char_to_vk(ch, shift)?;
    let mut inputs = Vec::new();

    if ctrl {
        inputs.extend(key_down_up(VK_CONTROL, false));
    }
    if alt {
        inputs.extend(key_down_up(VK_MENU, false));
    }
    if shift {
        inputs.extend(key_down_up(VK_SHIFT, false));
    }

    let scan = unsafe { MapVirtualKeyW(vk.0 as u32, MAPVK_VK_TO_VSC) } as u16;
    inputs.push(INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: Default::default(),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    });
    inputs.push(INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    });

    if shift {
        inputs.extend(key_down_up(VK_SHIFT, true));
    }
    if alt {
        inputs.extend(key_down_up(VK_MENU, true));
    }
    if ctrl {
        inputs.extend(key_down_up(VK_CONTROL, true));
    }

    send_inputs(&inputs)
}

#[cfg(windows)]
fn tap_special_key(token: &str, ctrl: bool, alt: bool, shift: bool) -> Result<(), String> {
    let vk = special_token_to_vk(token)?;
    tap_vk(vk, ctrl, alt, shift)
}

#[cfg(windows)]
fn tap_vk(vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY, ctrl: bool, alt: bool, shift: bool) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        MAPVK_VK_TO_VSC, VK_SHIFT, VK_CONTROL, VK_MENU,
    };

    let mut inputs = Vec::new();
    if ctrl {
        inputs.extend(key_down_up(VK_CONTROL, false));
    }
    if alt {
        inputs.extend(key_down_up(VK_MENU, false));
    }
    if shift {
        inputs.extend(key_down_up(VK_SHIFT, false));
    }

    let scan = unsafe { MapVirtualKeyW(vk.0 as u32, MAPVK_VK_TO_VSC) } as u16;
    inputs.push(INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: Default::default(),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    });
    inputs.push(INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    });

    if shift {
        inputs.extend(key_down_up(VK_SHIFT, true));
    }
    if alt {
        inputs.extend(key_down_up(VK_MENU, true));
    }
    if ctrl {
        inputs.extend(key_down_up(VK_CONTROL, true));
    }

    send_inputs(&inputs)
}

#[cfg(windows)]
fn key_down_up(
    vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
    key_up: bool,
) -> Vec<windows::Win32::UI::Input::KeyboardAndMouse::INPUT> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        MAPVK_VK_TO_VSC,
    };

    let scan = unsafe { MapVirtualKeyW(vk.0 as u32, MAPVK_VK_TO_VSC) } as u16;
    vec![INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: if key_up { KEYEVENTF_KEYUP } else { Default::default() },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }]
}

#[cfg(windows)]
fn send_inputs(inputs: &[windows::Win32::UI::Input::KeyboardAndMouse::INPUT]) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT};

    if inputs.is_empty() {
        return Ok(());
    }
    unsafe {
        let sent = SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
        if sent as usize != inputs.len() {
            return Err("sendinput_failed".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
fn char_to_vk(
    ch: char,
    shift: bool,
) -> Result<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY, String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY;
    let upper = if shift { ch.to_ascii_uppercase() } else { ch.to_ascii_lowercase() };
    if upper.is_ascii_alphabetic() {
        return Ok(VIRTUAL_KEY(upper as u8 as u16));
    }
    if upper.is_ascii_digit() {
        return Ok(VIRTUAL_KEY(upper as u8 as u16));
    }
    match upper {
        ' ' => Ok(VIRTUAL_KEY(0x20)),
        _ => Err(format!("unsupported_char:{ch}")),
    }
}

#[cfg(windows)]
fn special_token_to_vk(
    token: &str,
) -> Result<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY, String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY;
    let t = token.to_ascii_uppercase();
    match t.as_str() {
        "ENTER" | "RETURN" => Ok(VIRTUAL_KEY(0x0D)),
        "TAB" => Ok(VIRTUAL_KEY(0x09)),
        "ESC" | "ESCAPE" => Ok(VIRTUAL_KEY(0x1B)),
        "BACK" | "BACKSPACE" => Ok(VIRTUAL_KEY(0x08)),
        "DEL" | "DELETE" => Ok(VIRTUAL_KEY(0x2E)),
        "HOME" => Ok(VIRTUAL_KEY(0x24)),
        "END" => Ok(VIRTUAL_KEY(0x23)),
        "LEFT" => Ok(VIRTUAL_KEY(0x25)),
        "RIGHT" => Ok(VIRTUAL_KEY(0x27)),
        "UP" => Ok(VIRTUAL_KEY(0x26)),
        "DOWN" => Ok(VIRTUAL_KEY(0x28)),
        "SPACE" => Ok(VIRTUAL_KEY(0x20)),
        s if s.starts_with('F') && s.len() <= 3 => {
            let n: u16 = s[1..]
                .parse()
                .map_err(|_| format!("bad_function_key:{token}"))?;
            if (1..=24).contains(&n) {
                Ok(VIRTUAL_KEY(0x6F + n))
            } else {
                Err(format!("bad_function_key:{token}"))
            }
        }
        other => Err(format!("unknown_special_key:{other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sendkeys_tokens_without_panic() {
        let samples = ["^a", "{ENTER}", "^%+{F}", "^v"];
        for s in samples {
            let _ = send_keys_tokens(s);
        }
    }
}
