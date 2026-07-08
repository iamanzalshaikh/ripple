use crate::events::NativeEvent;
use crate::foreground;
use crate::ipc::protocol::{auth_result_json, capabilities_json, RpcRequest, RpcResponse, PROTOCOL};
use crate::send_input::{RunSequenceParams, SendKeysParams};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::sync::broadcast;

struct AppState {
    token: String,
    client_connected: AtomicBool,
}

struct ClientSession {
    authenticated: bool,
}

async fn read_frame(
    reader: &mut (impl AsyncReadExt + Unpin),
) -> std::io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 || len > 8 * 1024 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await?;
    Ok(Some(body))
}

async fn write_bytes(
    writer: &mut (impl AsyncWriteExt + Unpin),
    body: &[u8],
) -> std::io::Result<()> {
    let len = (body.len() as u32).to_le_bytes();
    writer.write_all(&len).await?;
    writer.write_all(body).await?;
    writer.flush().await?;
    Ok(())
}

async fn write_frame(
    writer: &mut (impl AsyncWriteExt + Unpin),
    value: &RpcResponse,
) -> std::io::Result<()> {
    write_bytes(writer, &serde_json::to_vec(value)?).await
}

async fn write_event(
    writer: &mut (impl AsyncWriteExt + Unpin),
    event: &NativeEvent,
) -> std::io::Result<()> {
    let json = match event {
        NativeEvent::Hotkey { name } => serde_json::json!({
            "event": "hotkey",
            "name": name,
        }),
        NativeEvent::ForegroundChanged {
            hwnd,
            process_name,
            window_title,
        } => serde_json::json!({
            "event": "foreground_changed",
            "hwnd": hwnd,
            "processName": process_name,
            "windowTitle": window_title,
        }),
    };
    write_bytes(writer, &serde_json::to_vec(&json)?).await
}

fn handle_rpc(
    req: &RpcRequest,
    session: &mut ClientSession,
    expected_token: &str,
) -> RpcResponse {
    let id = req.id.clone();

    if req.method == "auth" {
        let provided = req
            .params
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if provided != expected_token {
            return RpcResponse::err(id, "invalid_token");
        }
        session.authenticated = true;
        return RpcResponse::ok(id, auth_result_json());
    }

    if !session.authenticated {
        return RpcResponse::err(id, "not_authenticated");
    }

    match req.method.as_str() {
        "ping" => RpcResponse::ok(
            id,
            serde_json::json!({ "pong": true, "protocol": PROTOCOL }),
        ),
        "get_capabilities" => RpcResponse::ok(id, capabilities_json()),
        "get_foreground" => {
            let snap = foreground::get_cached().or_else(foreground::read_current_foreground);
            match snap {
                Some(row) => {
                    let value: Value = serde_json::to_value(row).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                None => RpcResponse::err(id, "no_foreground"),
            }
        }
        "send_keys" => match serde_json::from_value::<SendKeysParams>(req.params.clone()) {
            Ok(params) => match crate::send_input::send_keys(&params) {
                Ok(result) => {
                    let value = serde_json::to_value(result).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                Err(e) => RpcResponse::err(id, e),
            },
            Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
        },
        "run_input_sequence" => {
            match serde_json::from_value::<RunSequenceParams>(req.params.clone()) {
                Ok(params) => match crate::send_input::run_input_sequence(&params) {
                    Ok(result) => {
                        let value = serde_json::to_value(result).unwrap_or(Value::Null);
                        RpcResponse::ok(id, value)
                    }
                    Err(e) => RpcResponse::err(id, e),
                },
                Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
            }
        }
        "get_focused_a11y" => match crate::uia::get_focused_a11y_element() {
            Ok(Some(el)) => {
                let value = serde_json::to_value(el).unwrap_or(Value::Null);
                RpcResponse::ok(id, value)
            }
            Ok(None) => RpcResponse::ok(id, Value::Object(serde_json::Map::new())),
            Err(e) => RpcResponse::err(id, e),
        },
        "get_insert_text_a11y_diagnostics" => {
            match crate::uia::get_insert_text_a11y_diagnostics() {
                Ok(diag) => {
                    let value = serde_json::to_value(diag).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                Err(e) => RpcResponse::err(id, e),
            }
        }
        "list_windows" => {
            let rows = crate::window_list::list_visible_windows();
            let value = serde_json::to_value(rows).unwrap_or(Value::Null);
            RpcResponse::ok(id, value)
        },
        "screenshot_ocr" => match crate::ocr::screenshot_ocr_from_value(req.params.clone()) {
            Ok(result) => {
                let value = serde_json::to_value(result).unwrap_or(Value::Null);
                RpcResponse::ok(id, value)
            }
            Err(e) => RpcResponse::err(id, e),
        },
        "focus_window" => match serde_json::from_value::<crate::window_ops::FocusWindowParams>(req.params.clone()) {
            Ok(params) => match crate::window_ops::focus_window(&params) {
                Ok(result) => {
                    let value = serde_json::to_value(result).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                Err(e) => RpcResponse::err(id, e),
            },
            Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
        },
        "close_window" => match serde_json::from_value::<crate::window_ops::CloseWindowParams>(req.params.clone()) {
            Ok(params) => match crate::window_ops::close_window(&params) {
                Ok(result) => {
                    let value = serde_json::to_value(result).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                Err(e) => RpcResponse::err(id, e),
            },
            Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
        },
        "get_window_rect" => {
            match serde_json::from_value::<crate::window_ops::WindowRectParams>(req.params.clone()) {
                Ok(params) => match crate::window_ops::get_window_rect(&params) {
                    Ok(result) => {
                        let value = serde_json::to_value(result).unwrap_or(Value::Null);
                        RpcResponse::ok(id, value)
                    }
                    Err(e) => RpcResponse::err(id, e),
                },
                Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
            }
        }
        "mouse_click" => match serde_json::from_value::<crate::mouse::MouseClickParams>(req.params.clone()) {
            Ok(params) => match crate::mouse::mouse_click(&params) {
                Ok(result) => {
                    let value = serde_json::to_value(result).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                Err(e) => RpcResponse::err(id, e),
            },
            Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
        },
        "mouse_scroll" => match serde_json::from_value::<crate::mouse::MouseScrollParams>(req.params.clone()) {
            Ok(params) => match crate::mouse::mouse_scroll(&params) {
                Ok(result) => {
                    let value = serde_json::to_value(result).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                Err(e) => RpcResponse::err(id, e),
            },
            Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
        },
        "mouse_drag" => match serde_json::from_value::<crate::mouse::MouseDragParams>(req.params.clone()) {
            Ok(params) => match crate::mouse::mouse_drag(&params) {
                Ok(result) => {
                    let value = serde_json::to_value(result).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                Err(e) => RpcResponse::err(id, e),
            },
            Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
        },
        "mouse_move" => match serde_json::from_value::<crate::mouse::MouseMoveParams>(req.params.clone()) {
            Ok(params) => match crate::mouse::mouse_move(&params) {
                Ok(result) => {
                    let value = serde_json::to_value(result).unwrap_or(Value::Null);
                    RpcResponse::ok(id, value)
                }
                Err(e) => RpcResponse::err(id, e),
            },
            Err(e) => RpcResponse::err(id, format!("bad_params:{e}")),
        },
        "get_cursor_position" => match crate::mouse::get_cursor_position() {
            Ok(result) => {
                let value = serde_json::to_value(result).unwrap_or(Value::Null);
                RpcResponse::ok(id, value)
            }
            Err(e) => RpcResponse::err(id, e),
        },
        other => RpcResponse::err(id, format!("unknown_method:{other}")),
    }
}

async fn handle_client(
    mut pipe: tokio::net::windows::named_pipe::NamedPipeServer,
    state: Arc<AppState>,
    mut event_rx: broadcast::Receiver<NativeEvent>,
) {
    if state
        .client_connected
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        let _ = write_frame(
            &mut pipe,
            &RpcResponse::err(None, "already_connected"),
        )
        .await;
        return;
    }

    tracing::info!("pipe client connected");
    let mut session = ClientSession {
        authenticated: false,
    };

    loop {
        tokio::select! {
            read_result = read_frame(&mut pipe) => {
                let frame = match read_result {
                    Ok(Some(body)) => body,
                    Ok(None) => {
                        tracing::info!("pipe client disconnected (eof)");
                        break;
                    }
                    Err(e) => {
                        tracing::warn!("pipe read error: {e}");
                        break;
                    }
                };

                let req: RpcRequest = match serde_json::from_slice(&frame) {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = write_frame(
                            &mut pipe,
                            &RpcResponse::err(None, format!("bad_json:{e}")),
                        )
                        .await;
                        continue;
                    }
                };

                let resp = handle_rpc(&req, &mut session, &state.token);
                if let Err(e) = write_frame(&mut pipe, &resp).await {
                    tracing::warn!("pipe write error: {e}");
                    break;
                }
            }
            event_result = event_rx.recv() => {
                if !session.authenticated {
                    continue;
                }
                match event_result {
                    Ok(ev) => {
                        match &ev {
                            NativeEvent::Hotkey { name } => {
                                tracing::info!("hotkey event → {name}");
                            }
                            NativeEvent::ForegroundChanged { process_name, window_title, .. } => {
                                tracing::debug!(
                                    "foreground_changed → {process_name} \"{window_title}\""
                                );
                            }
                        }
                        if let Err(e) = write_event(&mut pipe, &ev).await {
                            tracing::warn!("pipe event write error: {e}");
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    state.client_connected.store(false, Ordering::SeqCst);
    tracing::info!("pipe client slot cleared");
}

pub async fn run_pipe_server(token: String, event_tx: broadcast::Sender<NativeEvent>) {
    let pipe_path = crate::config::pipe_name();
    let state = Arc::new(AppState {
        token,
        client_connected: AtomicBool::new(false),
    });

    let first = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe_path)
        .expect("create named pipe");

    tracing::info!("pipe listening → {pipe_path}");

    let mut server = first;
    loop {
        if let Err(e) = server.connect().await {
            tracing::error!("pipe connect wait failed: {e}");
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            continue;
        }

        let connected = server;

        loop {
            match ServerOptions::new().create(&pipe_path) {
                Ok(s) => {
                    server = s;
                    break;
                }
                Err(e) => {
                    tracing::error!("create next pipe instance failed: {e}");
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }

        let client_state = Arc::clone(&state);
        let event_rx = event_tx.subscribe();
        tokio::spawn(async move {
            handle_client(connected, client_state, event_rx).await;
        });
    }
}
