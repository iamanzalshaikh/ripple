use serde::Serialize;

#[derive(Debug, Clone)]
pub enum NativeEvent {
    Hotkey { name: String },
    ForegroundChanged {
        hwnd: i64,
        process_name: String,
        window_title: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ForegroundSnapshot {
    pub hwnd: i64,
    #[serde(rename = "processName")]
    pub process_name: String,
    #[serde(rename = "windowTitle")]
    pub window_title: String,
}

impl ForegroundSnapshot {
    pub fn to_native_event(&self) -> NativeEvent {
        NativeEvent::ForegroundChanged {
            hwnd: self.hwnd,
            process_name: self.process_name.clone(),
            window_title: self.window_title.clone(),
        }
    }
}
