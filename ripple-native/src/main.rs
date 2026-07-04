mod config;
mod elevation;
mod events;
mod foreground;
mod hotkeys;
mod ipc;
mod mouse;
mod ocr;
mod send_input;
mod session;
mod uia;
mod window_list;
mod window_ops;

use session::{generate_token, write_session};
use tokio::sync::broadcast;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("ripple_native=info".parse().unwrap()),
        )
        .with_target(false)
        .init();

    #[cfg(not(windows))]
    {
        tracing::error!("ripple-native requires Windows");
        std::process::exit(1);
    }

    #[cfg(windows)]
    {
        let token = generate_token();
        match write_session(&token) {
            Ok(info) => {
                tracing::info!(
                    "ripple-native v{} protocol={} pid={}",
                    env!("CARGO_PKG_VERSION"),
                    ipc::protocol::PROTOCOL,
                    info.pid
                );
            }
            Err(e) => {
                tracing::error!("failed to write session file: {e}");
                std::process::exit(1);
            }
        }

        let (event_tx, _) = broadcast::channel::<events::NativeEvent>(64);
        hotkeys::start(event_tx.clone());
        ipc::run_pipe_server(token, event_tx).await;
    }
}
