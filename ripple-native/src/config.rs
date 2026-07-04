pub const PROTOCOL: u32 = 1;

pub fn ripple_data_dir() -> std::path::PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("USERPROFILE")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    base.join("Ripple")
}

pub fn session_file_path() -> std::path::PathBuf {
    ripple_data_dir().join("ripple-native.session")
}

pub fn pipe_name() -> String {
    let pid = std::process::id();
    format!(r"\\.\pipe\Ripple.Native.{}", pid)
}
