use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use base64::Engine as _;
use futures::{sink::SinkExt, stream::StreamExt};
use hmac::{Hmac, Mac as _};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{mpsc, Mutex};
use tracing::{error, info, warn};

type HmacSha1 = Hmac<Sha1>;

#[derive(Clone)]
struct AppState {
    rooms: Arc<Mutex<HashMap<String, Room>>>,
    turn: Option<TurnConfig>,
}

#[derive(Clone)]
struct TurnConfig {
    secret: String,
    urls: Vec<String>,
    ttl: Duration,
}

#[derive(Default)]
struct Room {
    host: Option<Peer>,
    client: Option<Peer>,
}

#[derive(Clone)]
struct Peer {
    tx: mpsc::UnboundedSender<Message>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClientToServerMessage {
    #[serde(rename = "join")]
    Join { room: String, role: SignalingRole },
    #[serde(rename = "leave")]
    Leave,
    #[serde(rename = "signal")]
    Signal { data: serde_json::Value },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum ServerToClientMessage {
    #[serde(rename = "joined")]
    Joined {
        room: String,
        role: SignalingRole,
        #[serde(rename = "peerPresent")]
        peer_present: bool,
    },
    #[serde(rename = "peer_joined")]
    PeerJoined { role: SignalingRole },
    #[serde(rename = "peer_left")]
    PeerLeft { role: SignalingRole },
    #[serde(rename = "signal")]
    Signal {
        from: SignalingRole,
        data: serde_json::Value,
    },
    #[serde(rename = "error")]
    Error { code: String, message: String },
}

#[derive(Debug, Deserialize, Serialize, Copy, Clone, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum SignalingRole {
    Host,
    Client,
}

impl SignalingRole {
    fn other(self) -> Self {
        match self {
            Self::Host => Self::Client,
            Self::Client => Self::Host,
        }
    }
}

#[derive(Debug, Serialize)]
struct TurnResponse {
    #[serde(rename = "iceServers")]
    ice_servers: Vec<IceServer>,
}

#[derive(Debug, Serialize)]
struct IceServer {
    urls: Vec<String>,
    username: String,
    credential: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,axum=info,tower_http=info".into()),
        )
        .init();

    let bind = std::env::var("SIGNAL_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let addr: SocketAddr = bind
        .parse()
        .unwrap_or_else(|_| panic!("Invalid SIGNAL_BIND: {bind}"));

    let turn = match (std::env::var("TURN_SECRET"), std::env::var("TURN_URLS")) {
        (Ok(secret), Ok(urls)) => {
            let parsed_urls = urls
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect::<Vec<_>>();
            if parsed_urls.is_empty() {
                warn!("TURN_URLS provided but empty; TURN disabled");
                None
            } else {
                let ttl = std::env::var("TURN_TTL_SECONDS")
                    .ok()
                    .and_then(|s| s.parse::<u64>().ok())
                    .map(Duration::from_secs)
                    .unwrap_or(Duration::from_secs(3600));
                Some(TurnConfig {
                    secret,
                    urls: parsed_urls,
                    ttl,
                })
            }
        }
        _ => None,
    };

    let app_state = AppState {
        rooms: Arc::new(Mutex::new(HashMap::new())),
        turn,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/turn", get(turn_handler))
        .route("/ws", get(ws_handler))
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind {addr}: {e}"));

    info!("signaling server listening on http://{addr} (ws: /ws)");
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "ok"
}

async fn turn_handler(State(state): State<AppState>) -> Result<Json<TurnResponse>, StatusCode> {
    let Some(turn) = state.turn else {
        return Ok(Json(TurnResponse { ice_servers: vec![] }));
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .as_secs();
    let expires = now + turn.ttl.as_secs();

    let username = format!("{expires}:remote-vnc");
    let mut mac = HmacSha1::new_from_slice(turn.secret.as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    mac.update(username.as_bytes());
    let password = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());

    Ok(Json(TurnResponse {
        ice_servers: vec![IceServer {
            urls: turn.urls.clone(),
            username,
            credential: password,
        }],
    }))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    let mut joined: Option<(String, SignalingRole)> = None;
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = ws_rx.next().await {
        let Message::Text(text) = msg else {
            continue;
        };

        let parsed = match serde_json::from_str::<ClientToServerMessage>(&text) {
            Ok(v) => v,
            Err(e) => {
                warn!("invalid message: {e}");
                send_json(
                    &tx,
                    &ServerToClientMessage::Error {
                        code: "invalid_message".into(),
                        message: "Invalid signaling message".into(),
                    },
                );
                continue;
            }
        };

        match parsed {
            ClientToServerMessage::Join { room, role } => {
                if joined.is_some() {
                    send_json(
                        &tx,
                        &ServerToClientMessage::Error {
                            code: "already_joined".into(),
                            message: "Already joined a room".into(),
                        },
                    );
                    continue;
                }

                let (peer_present, notify_other) = {
                    let mut rooms = state.rooms.lock().await;
                    let entry = rooms.entry(room.clone()).or_default();

                    let slot = match role {
                        SignalingRole::Host => &mut entry.host,
                        SignalingRole::Client => &mut entry.client,
                    };

                    if slot.is_some() {
                        (false, false)
                    } else {
                        *slot = Some(Peer { tx: tx.clone() });
                        let peer_present = match role.other() {
                            SignalingRole::Host => entry.host.is_some(),
                            SignalingRole::Client => entry.client.is_some(),
                        };
                        (peer_present, true)
                    }
                };

                if !notify_other {
                    send_json(
                        &tx,
                        &ServerToClientMessage::Error {
                            code: "role_taken".into(),
                            message: "Role already taken in room".into(),
                        },
                    );
                    continue;
                }

                joined = Some((room.clone(), role));
                send_json(
                    &tx,
                    &ServerToClientMessage::Joined {
                        room: room.clone(),
                        role,
                        peer_present: peer_present,
                    },
                );

                if let Some(other_tx) = get_other_peer(&state, &room, role).await {
                    send_json(&other_tx, &ServerToClientMessage::PeerJoined { role });
                }
            }
            ClientToServerMessage::Leave => {
                break;
            }
            ClientToServerMessage::Signal { data } => {
                let Some((room, role)) = &joined else {
                    send_json(
                        &tx,
                        &ServerToClientMessage::Error {
                            code: "not_joined".into(),
                            message: "Join a room before signaling".into(),
                        },
                    );
                    continue;
                };

                if let Some(other_tx) = get_other_peer(&state, room, *role).await {
                    send_json(
                        &other_tx,
                        &ServerToClientMessage::Signal {
                            from: *role,
                            data,
                        },
                    );
                }
            }
        }
    }

    let Some((room, role)) = joined else {
        forward_task.abort();
        return;
    };

    remove_peer(&state, &room, role).await;
    if let Some(other_tx) = get_other_peer(&state, &room, role).await {
        send_json(&other_tx, &ServerToClientMessage::PeerLeft { role });
    }

    forward_task.abort();
}

async fn get_other_peer(
    state: &AppState,
    room: &str,
    role: SignalingRole,
) -> Option<mpsc::UnboundedSender<Message>> {
    let rooms = state.rooms.lock().await;
    let entry = rooms.get(room)?;
    let peer = match role.other() {
        SignalingRole::Host => entry.host.as_ref(),
        SignalingRole::Client => entry.client.as_ref(),
    }?;
    Some(peer.tx.clone())
}

async fn remove_peer(state: &AppState, room: &str, role: SignalingRole) {
    let mut rooms = state.rooms.lock().await;
    let Some(entry) = rooms.get_mut(room) else {
        return;
    };

    match role {
        SignalingRole::Host => entry.host = None,
        SignalingRole::Client => entry.client = None,
    }

    if entry.host.is_none() && entry.client.is_none() {
        rooms.remove(room);
    }
}

fn send_json(tx: &mpsc::UnboundedSender<Message>, msg: &ServerToClientMessage) {
    match serde_json::to_string(msg) {
        Ok(text) => {
            let _ = tx.send(Message::Text(text));
        }
        Err(e) => {
            error!("failed to serialize msg: {e}");
        }
    }
}
