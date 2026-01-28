import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildIceServers, fetchTurnIceServers } from "../lib/ice";
import {
  asString,
  isObject,
  safeParseJson,
  parseServerMessage,
  type ClientToServerMessage,
} from "../protocol/signaling";
import { parseSignalPayload } from "../protocol/webrtcSignal";
import type { ConnectionStatus, PersistedSettings, SessionError } from "../types";
import type { ControlInput, ControlMessage, HostInfo, InputEvent } from "../protocol/control";

type Props = {
  settings: PersistedSettings;
  onBack: () => void;
};

export default function HostScreen({ settings, onBack }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<SessionError | null>(null);
  const [allowControl, setAllowControl] = useState(false);
  const [peerPresent, setPeerPresent] = useState(false);
  const [captureInfo, setCaptureInfo] = useState<HostInfo["capture"] | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const makingOfferRef = useRef(false);
  const allowControlRef = useRef(false);
  const captureInfoRef = useRef<HostInfo["capture"] | null>(null);
  const injectionErrorRef = useRef(false);

  const room = useMemo(() => normalizeRoom(settings.room), [settings.room]);

  useEffect(() => () => stop(), []);
  useEffect(() => {
    allowControlRef.current = allowControl;
  }, [allowControl]);
  useEffect(() => {
    captureInfoRef.current = captureInfo;
  }, [captureInfo]);

  async function start() {
    stop();
    setError(null);
    setPeerPresent(false);
    setCaptureInfo(null);
    setStatus("starting");
    injectionErrorRef.current = false;

    if (!room) {
      setStatus("error");
      setError({ message: "Room code is required" });
      return;
    }

    const signalingUrl = settings.signalingUrl.trim();
    if (!signalingUrl) {
      setStatus("error");
      setError({ message: "Signaling WebSocket URL is required" });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    } catch (cause) {
      setStatus("error");
      setError({ message: "Screen capture was cancelled or denied", cause });
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }

    const track = stream.getVideoTracks()[0] ?? null;
    const trackSettings = track?.getSettings() ?? {};
    const width = typeof trackSettings.width === "number" ? trackSettings.width : 0;
    const height = typeof trackSettings.height === "number" ? trackSettings.height : 0;
    const frameRate =
      typeof trackSettings.frameRate === "number" ? trackSettings.frameRate : undefined;

    const hostInfo: HostInfo = {
      t: "host_info",
      protocol: 1,
      capture: { width, height, frameRate },
    };
    setCaptureInfo(hostInfo.capture);

    let iceServers = buildIceServers(settings);
    try {
      const turnServers = await fetchTurnIceServers(settings);
      iceServers = [...iceServers, ...turnServers];
    } catch {
      // ignore TURN fetch failures (still usable for LAN)
    }

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    for (const mediaTrack of stream.getTracks()) {
      pc.addTrack(mediaTrack, stream);
    }

    const dc = pc.createDataChannel("control", { ordered: true });
    dcRef.current = dc;

    dc.addEventListener("open", () => {
      sendControl(dc, { t: "hello", protocol: 1, role: "host" });
      sendControl(dc, hostInfo);
    });

    dc.addEventListener("message", (ev) => {
      if (!allowControlRef.current) return;
      const raw = safeParseJson(String(ev.data));
      const input = parseControlInput(raw);
      if (!input) return;
      const cap = captureInfoRef.current;
      if (!cap || cap.width <= 0 || cap.height <= 0) return;
      void invoke("inject_input_batch", {
        events: input.events,
        capture_width: cap.width,
        capture_height: cap.height,
      }).catch((cause) => {
        if (injectionErrorRef.current) return;
        injectionErrorRef.current = true;
        setError({ message: "Input injection failed (check OS permissions)", cause });
      });
    });

    pc.addEventListener("connectionstatechange", () => {
      const s = pc.connectionState;
      if (s === "connected") setStatus("connected");
      if (s === "failed" || s === "disconnected") setStatus("disconnected");
      if (s === "closed") setStatus("idle");
    });

    const ws = new WebSocket(signalingUrl);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      const join: ClientToServerMessage = { type: "join", room, role: "host" };
      ws.send(JSON.stringify(join));
      setStatus("waiting_for_peer");
    });

    ws.addEventListener("close", () => {
      setStatus((prev) => (prev === "idle" ? prev : "disconnected"));
    });

    ws.addEventListener("error", () => {
      setStatus("error");
      setError({ message: "Signaling WebSocket error" });
    });

    ws.addEventListener("message", async (ev) => {
      const raw = safeParseJson(String(ev.data));
      const msg = parseServerMessage(raw);
      if (!msg) return;

      if (msg.type === "error") {
        setStatus("error");
        setError({ message: `${msg.code}: ${msg.message}` });
        return;
      }

      if (msg.type === "joined") {
        setPeerPresent(msg.peerPresent);
        if (msg.peerPresent) {
          await makeOffer(pc, ws);
        }
        return;
      }

      if (msg.type === "peer_joined") {
        setPeerPresent(true);
        await makeOffer(pc, ws);
        return;
      }

      if (msg.type === "peer_left") {
        setPeerPresent(false);
        setStatus("waiting_for_peer");
        return;
      }

      if (msg.type === "signal") {
        const payload = parseSignalPayload(msg.data);
        if (!payload) return;
        if (payload.kind === "description") {
          await pc.setRemoteDescription(payload.description);
          return;
        }
        if (payload.kind === "candidate") {
          try {
            await pc.addIceCandidate(payload.candidate);
          } catch {
            // ignore candidates that race with renegotiation
          }
        }
      }
    });

    pc.addEventListener("icecandidate", (ev) => {
      if (!ev.candidate) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      const data = {
        kind: "candidate",
        candidate: ev.candidate.toJSON(),
      };
      const signal: ClientToServerMessage = { type: "signal", data };
      ws.send(JSON.stringify(signal));
    });
  }

  function stop() {
    setStatus("idle");
    setPeerPresent(false);
    setCaptureInfo(null);
    injectionErrorRef.current = false;

    dcRef.current?.close();
    dcRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    wsRef.current?.close();
    wsRef.current = null;

    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;
    makingOfferRef.current = false;
  }

  async function makeOffer(pc: RTCPeerConnection, ws: WebSocket) {
    if (makingOfferRef.current) return;
    makingOfferRef.current = true;
    setStatus("negotiating");
    try {
      if (ws.readyState !== WebSocket.OPEN) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const desc = pc.localDescription;
      if (!desc) return;
      const data = { kind: "description", description: desc.toJSON() };
      const signal: ClientToServerMessage = { type: "signal", data };
      ws.send(JSON.stringify(signal));
    } finally {
      makingOfferRef.current = false;
    }
  }

  return (
    <div className="screen screen--host">
      <header className="topbar">
        <button type="button" className="topbar__btn" onClick={() => { stop(); onBack(); }}>
          Back
        </button>
        <div className="topbar__title">Host</div>
        <button type="button" className="topbar__btn" onClick={stop} disabled={status === "idle"}>
          Stop
        </button>
      </header>

      <div className="host">
        <section className="card">
          <div className="kv">
            <div className="kv__label">Room</div>
            <div className="kv__value mono kv__value--big">{room || "—"}</div>
          </div>

          <div className="kv">
            <div className="kv__label">Status</div>
            <div className="kv__value">{humanStatus(status, peerPresent)}</div>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={allowControl}
              onChange={(e) => setAllowControl(e.currentTarget.checked)}
              disabled={status !== "connected"}
            />
            <span>Allow remote control (inject input)</span>
          </label>

          {captureInfo && (
            <div className="kv">
              <div className="kv__label">Capture</div>
              <div className="kv__value mono">
                {captureInfo.width}×{captureInfo.height}
                {captureInfo.frameRate ? ` @ ${Math.round(captureInfo.frameRate)}fps` : ""}
              </div>
            </div>
          )}

          {error && (
            <div className="error" role="alert">
              {error.message}
            </div>
          )}

          {status === "idle" && (
            <button type="button" className="primaryButton" onClick={() => void start()}>
              Start sharing
            </button>
          )}
        </section>

        <section className="preview" aria-label="Local preview">
          <video ref={videoRef} className="preview__video" playsInline muted />
        </section>
      </div>
    </div>
  );
}

function normalizeRoom(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function sendControl(channel: RTCDataChannel, msg: ControlMessage) {
  channel.send(JSON.stringify(msg));
}

function parseControlInput(raw: unknown): ControlInput | null {
  if (!isObject(raw)) return null;
  const t = asString(raw.t);
  if (t !== "input") return null;
  const eventsRaw = Array.isArray(raw.events) ? raw.events : null;
  if (!eventsRaw) return null;

  const events: InputEvent[] = [];
  for (const ev of eventsRaw) {
    const parsed = parseInputEvent(ev);
    if (parsed) events.push(parsed);
  }

  return { t: "input", events };
}

function parseInputEvent(raw: unknown): InputEvent | null {
  if (!isObject(raw)) return null;
  const k = asString(raw.k);
  if (!k) return null;

  if (k === "mouse_move") {
    const x = typeof raw.x === "number" ? raw.x : null;
    const y = typeof raw.y === "number" ? raw.y : null;
    if (x == null || y == null) return null;
    return { k, x, y };
  }

  if (k === "mouse_button") {
    const button = typeof raw.button === "number" ? raw.button : null;
    const down = typeof raw.down === "boolean" ? raw.down : null;
    if (button == null || down == null) return null;
    if (button !== 0 && button !== 1 && button !== 2) return null;
    return { k, button, down };
  }

  if (k === "mouse_wheel") {
    const dx = typeof raw.dx === "number" ? raw.dx : null;
    const dy = typeof raw.dy === "number" ? raw.dy : null;
    if (dx == null || dy == null) return null;
    return { k, dx, dy };
  }

  if (k === "key") {
    const code = asString(raw.code);
    const down = typeof raw.down === "boolean" ? raw.down : null;
    const alt = typeof raw.alt === "boolean" ? raw.alt : false;
    const ctrl = typeof raw.ctrl === "boolean" ? raw.ctrl : false;
    const meta = typeof raw.meta === "boolean" ? raw.meta : false;
    const shift = typeof raw.shift === "boolean" ? raw.shift : false;
    if (!code || down == null) return null;
    return { k, code, down, alt, ctrl, meta, shift };
  }

  return null;
}

function humanStatus(status: ConnectionStatus, peerPresent: boolean): string {
  if (status === "waiting_for_peer") return peerPresent ? "Peer connected" : "Waiting for client…";
  if (status === "starting") return "Starting…";
  if (status === "connecting") return "Connecting…";
  if (status === "negotiating") return "Negotiating…";
  if (status === "connected") return "Connected";
  if (status === "disconnected") return "Disconnected";
  if (status === "error") return "Error";
  return "Idle";
}
