use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL: u32 = 1;
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub id: Option<String>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub id: Option<String>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CapabilityFlags {
    pub platform: &'static str,
    pub protocol: u32,
    pub version: &'static str,
    pub sendInput: bool,
    pub uia: bool,
    pub ocr: bool,
    pub globalHotkey: bool,
    pub elevationInjection: bool,
    pub foregroundEvents: bool,
    pub mouse: bool,
    pub windowOps: bool,
}

impl CapabilityFlags {
    pub fn current() -> Self {
        Self {
            platform: "win32",
            protocol: PROTOCOL,
            version: VERSION,
            sendInput: true,
            uia: true,
            ocr: crate::ocr::is_ocr_available(),
            globalHotkey: crate::hotkeys::global_hotkeys_active(),
            elevationInjection: false,
            foregroundEvents: true,
            mouse: true,
            windowOps: true,
        }
    }
}

impl RpcResponse {
    pub fn ok(id: Option<String>, result: Value) -> Self {
        Self {
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: Option<String>, error: impl Into<String>) -> Self {
        Self {
            id,
            ok: false,
            result: None,
            error: Some(error.into()),
        }
    }
}

pub fn capabilities_json() -> Value {
    let caps = CapabilityFlags::current();
    serde_json::to_value(caps).unwrap_or(Value::Null)
}

pub fn auth_result_json() -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("version".into(), Value::String(VERSION.to_string()));
    obj.insert(
        "protocol".into(),
        Value::Number(serde_json::Number::from(PROTOCOL)),
    );
    obj.insert("capabilities".into(), capabilities_json());
    Value::Object(obj)
}
