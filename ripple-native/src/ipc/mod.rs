pub mod protocol;

#[cfg(windows)]
mod pipe_server;

#[cfg(windows)]
pub use pipe_server::run_pipe_server;

#[cfg(not(windows))]
pub async fn run_pipe_server(
    _token: String,
    _event_tx: tokio::sync::broadcast::Sender<crate::events::NativeEvent>,
) {
    tracing::error!("ripple-native requires Windows");
}
