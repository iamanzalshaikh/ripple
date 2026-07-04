use crate::config;
use rand::RngCore;
use serde::Serialize;
use std::fs;
use std::io::Write;

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub pipe: String,
    pub token: String,
    pub pid: u32,
}

pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn write_session(token: &str) -> std::io::Result<SessionInfo> {
    let dir = config::ripple_data_dir();
    fs::create_dir_all(&dir)?;
    let info = SessionInfo {
        pipe: config::pipe_name(),
        token: token.to_string(),
        pid: std::process::id(),
    };
    let path = config::session_file_path();
    let json = serde_json::to_string_pretty(&info)?;
    let mut file = fs::File::create(&path)?;
    file.write_all(json.as_bytes())?;
    file.sync_all()?;
    tracing::info!("session file → {}", path.display());
    Ok(info)
}
