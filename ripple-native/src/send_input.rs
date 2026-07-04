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
pub fn focus_hwnd(hwnd: windows::Win32::Foundation::HWND, _title_hint: Option<&str>) -> Result<(), String> {
    use windows::Win32::System::Threading::AttachThreadInput;
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, BringWindowToTop, GetForegroundWindow,
        GetWindowThreadProcessId, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };

    unsafe {
        if hwnd.0.is_null() {
            return Err("invalid_hwnd".into());
        }
        let _ = AllowSetForegroundWindow(0xFFFF_FFFF);
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        let _ = BringWindowToTop(hwnd);

        let fg = GetForegroundWindow();
        let mut fg_pid = 0u32;
        let mut target_pid = 0u32;
        let fg_thread = GetWindowThreadProcessId(fg, Some(&mut fg_pid));
        let target_thread = GetWindowThreadProcessId(hwnd, Some(&mut target_pid));
        if fg_thread != 0 && target_thread != 0 && fg_thread != target_thread {
            let _ = AttachThreadInput(fg_thread, target_thread, true);
            let _ = SetForegroundWindow(hwnd);
            let _ = AttachThreadInput(fg_thread, target_thread, false);
        } else {
            let _ = SetForegroundWindow(hwnd);
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
        std::thread::sleep(std::time::Duration::from_millis(8));
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
