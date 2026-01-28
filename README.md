# remote-vnc (Tauri + Rust + React)

Cross-platform remote desktop MVP based on the `REMOTE_DESKTOP_TECH_PLAN.md` architecture:

- Video: WebRTC (screen capture via `getDisplayMedia`)
- Control: WebRTC DataChannel → Tauri command → native input injection (`enigo`)
- Signaling: Rust WebSocket server (`axum`)

## Run

### 1) Start the signaling server

```bash
cd src-tauri
cargo run --bin signaling_server
```

Or:

```bash
npm run signal
```

Defaults:
- HTTP: `http://0.0.0.0:8080/health`
- WS: `ws://0.0.0.0:8080/ws`

Optional TURN REST config (server exposes `/turn`):

```bash
export TURN_SECRET="your-shared-secret"
export TURN_URLS="turn:your.turn.host:3478?transport=udp,turn:your.turn.host:3478?transport=tcp,turns:your.turn.host:5349?transport=tcp"
export TURN_TTL_SECONDS="3600"
```

### 2) Run the Tauri app

```bash
npm run tauri dev
```

Open two instances of the app:
- On the remote machine: `Host` → `Start sharing` → share the screen.
- On the controlling machine: `Client` → enter the same room code → `Connect`.
- After connected: enable `Allow remote control (inject input)` on the Host.

## Notes / Limitations

- macOS needs Screen Recording (capture) + Accessibility (input injection) permissions.
- Linux Wayland environments often restrict global input injection; X11 works better for full control.
- This is an MVP: no authentication/authorization yet. Use only on trusted networks.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
