import { useEffect, useMemo, useRef, useState } from "react";
import { buildIceServers, fetchTurnIceServers } from "../lib/ice";
import { safeParseJson, parseServerMessage, type ClientToServerMessage } from "../protocol/signaling";
import type { ControlMessage, HostInfo, InputEvent } from "../protocol/control";
import { parseSignalPayload } from "../protocol/webrtcSignal";
import type { ConnectionStatus, PersistedSettings, SessionError } from "../types";

type Props = {
  settings: PersistedSettings;
  onBack: () => void;
};

export default function ClientScreen({ settings, onBack }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<SessionError | null>(null);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [captureKeyboard, setCaptureKeyboard] = useState(false);
  const [statsText, setStatsText] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const makingAnswerRef = useRef(false);
  const statsIntervalRef = useRef<number | null>(null);
  const lastStatsRef = useRef<{ ts: number; bytes: number } | null>(null);

  const inputQueueRef = useRef<InputEvent[]>([]);
  const flushRafRef = useRef<number | null>(null);
  const lastMouseMoveRef = useRef<{ x: number; y: number } | null>(null);

  const room = useMemo(() => normalizeRoom(settings.room), [settings.room]);

  useEffect(() => () => disconnect(), []);

  useEffect(() => {
    if (!captureKeyboard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      if (e.repeat) return;
      e.preventDefault();
      queueInput({
        k: "key",
        code: e.code,
        down: true,
        alt: e.altKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      e.preventDefault();
      queueInput({
        k: "key",
        code: e.code,
        down: false,
        alt: e.altKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [captureKeyboard]);

  async function connect() {
    disconnect();
    setError(null);
    setHostInfo(null);
    setStatsText("");
    setStatus("connecting");

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

    let iceServers = buildIceServers(settings);
    try {
      const turnServers = await fetchTurnIceServers(settings);
      iceServers = [...iceServers, ...turnServers];
    } catch {
      // ignore TURN fetch failures
    }

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    startStatsLoop(pc);

    pc.addEventListener("track", (ev) => {
      const stream = ev.streams[0];
      if (stream && videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
    });

    pc.addEventListener("datachannel", (ev) => {
      dcRef.current = ev.channel;
      ev.channel.addEventListener("open", () => {
        sendControl(ev.channel, { t: "hello", protocol: 1, role: "client" });
      });
      ev.channel.addEventListener("message", (msgEv) => {
        const raw = safeParseJson(String(msgEv.data));
        const parsed = parseControlMessage(raw);
        if (!parsed) return;
        if (parsed.t === "host_info") setHostInfo(parsed);
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
      const join: ClientToServerMessage = { type: "join", room, role: "client" };
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

      if (msg.type === "signal") {
        const payload = parseSignalPayload(msg.data);
        if (!payload) return;

        if (payload.kind === "description") {
          if (payload.description.type !== "offer") return;
          await answerOffer(pc, ws, payload.description);
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

  function disconnect() {
    setStatus("idle");
    setHostInfo(null);
    setCaptureKeyboard(false);
    setStatsText("");
    lastMouseMoveRef.current = null;

    if (flushRafRef.current != null) cancelAnimationFrame(flushRafRef.current);
    flushRafRef.current = null;
    inputQueueRef.current = [];

    dcRef.current?.close();
    dcRef.current = null;

    if (statsIntervalRef.current != null) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    lastStatsRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    wsRef.current?.close();
    wsRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function answerOffer(
    pc: RTCPeerConnection,
    ws: WebSocket,
    offer: RTCSessionDescriptionInit,
  ) {
    if (makingAnswerRef.current) return;
    makingAnswerRef.current = true;
    setStatus("negotiating");
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const desc = pc.localDescription;
      if (!desc) return;
      const data = { kind: "description", description: desc.toJSON() };
      const signal: ClientToServerMessage = { type: "signal", data };
      ws.send(JSON.stringify(signal));
    } finally {
      makingAnswerRef.current = false;
    }
  }

  function queueInput(ev: InputEvent) {
    inputQueueRef.current.push(ev);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushRafRef.current != null) return;
    flushRafRef.current = requestAnimationFrame(() => {
      flushRafRef.current = null;
      flushInput();
    });
  }

  function flushInput() {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== "open") {
      inputQueueRef.current = [];
      return;
    }
    if (lastMouseMoveRef.current) {
      inputQueueRef.current.push({
        k: "mouse_move",
        x: lastMouseMoveRef.current.x,
        y: lastMouseMoveRef.current.y,
      });
      lastMouseMoveRef.current = null;
    }
    if (inputQueueRef.current.length === 0) return;
    const msg: ControlMessage = { t: "input", events: inputQueueRef.current };
    inputQueueRef.current = [];
    channel.send(JSON.stringify(msg));
  }

  function sendMouseMove(clientX: number, clientY: number) {
    const coords = computeVideoNormalizedCoords({
      clientX,
      clientY,
      surface: surfaceRef.current,
      video: videoRef.current,
    });
    if (!coords) return;
    lastMouseMoveRef.current = coords;
    scheduleFlush();
  }

  const connected = status === "connected";

  function startStatsLoop(pc: RTCPeerConnection) {
    if (statsIntervalRef.current != null) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    statsIntervalRef.current = window.setInterval(async () => {
      if (pc.connectionState === "closed") {
        if (statsIntervalRef.current != null) clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
        return;
      }

      const report = await pc.getStats();
      let rttMs: number | null = null;
      let bytesReceived: number | null = null;
      let fps: number | null = null;

      report.forEach((stat) => {
        if (stat.type === "candidate-pair" && "currentRoundTripTime" in stat) {
          const nominated = "nominated" in stat ? Boolean(stat.nominated) : false;
          const succeeded = "state" in stat ? stat.state === "succeeded" : false;
          if (nominated || succeeded) {
            const rtt = Number(stat.currentRoundTripTime);
            if (Number.isFinite(rtt) && rtt > 0) rttMs = rtt * 1000;
          }
        }

        if (stat.type === "inbound-rtp" && "kind" in stat && stat.kind === "video") {
          if ("bytesReceived" in stat) bytesReceived = Number(stat.bytesReceived);
          if ("framesPerSecond" in stat) fps = Number(stat.framesPerSecond);
        }
      });

      const now = Date.now();
      let rxMbps: number | null = null;
      if (bytesReceived != null && Number.isFinite(bytesReceived)) {
        const last = lastStatsRef.current;
        if (last) {
          const dt = (now - last.ts) / 1000;
          const dBytes = bytesReceived - last.bytes;
          if (dt > 0 && dBytes > 0) rxMbps = (dBytes * 8) / dt / 1_000_000;
        }
        lastStatsRef.current = { ts: now, bytes: bytesReceived };
      }

      const bits: string[] = [];
      if (rttMs != null) bits.push(`RTT ${Math.round(rttMs)}ms`);
      if (rxMbps != null) bits.push(`RX ${rxMbps.toFixed(2)}Mbps`);
      if (fps != null && Number.isFinite(fps)) bits.push(`FPS ${Math.round(fps)}`);
      bits.push(`State ${pc.connectionState}`);
      setStatsText(bits.join(" · "));
    }, 1000);
  }

  return (
    <div className="screen screen--client">
      <header className="topbar">
        <button type="button" className="topbar__btn" onClick={() => { disconnect(); onBack(); }}>
          Back
        </button>
        <div className="topbar__title">Client</div>
        <button type="button" className="topbar__btn" onClick={disconnect} disabled={status === "idle"}>
          Disconnect
        </button>
      </header>

      <div className="client">
        <section className="card card--compact">
          <div className="kv">
            <div className="kv__label">Room</div>
            <div className="kv__value mono">{room || "—"}</div>
          </div>

          <div className="kv">
            <div className="kv__label">Status</div>
            <div className="kv__value">{humanStatus(status)}</div>
          </div>

          {hostInfo && (
            <div className="kv">
              <div className="kv__label">Remote</div>
              <div className="kv__value mono">
                {hostInfo.capture.width}×{hostInfo.capture.height}
              </div>
            </div>
          )}

          <div className="toolbarRow">
            <button
              type="button"
              className="secondaryButton"
              onClick={() => setCaptureKeyboard((v) => !v)}
              disabled={!connected}
              data-active={captureKeyboard ? "true" : "false"}
            >
              Keyboard
            </button>
            <button
              type="button"
              className="secondaryButton"
              disabled
              title="Reserved for view mode / scaling controls"
            >
              View
            </button>
          </div>

          {status === "idle" && (
            <button type="button" className="primaryButton" onClick={() => void connect()}>
              Connect
            </button>
          )}

          {error && (
            <div className="error" role="alert">
              {error.message}
            </div>
          )}

          {statsText && (
            <div className="stats mono" aria-label="WebRTC stats">
              {statsText}
            </div>
          )}
        </section>

        <section className="remote" aria-label="Remote session">
          <div
            ref={surfaceRef}
            className="remote__surface"
            tabIndex={0}
            data-connected={connected ? "true" : "false"}
            onMouseMove={(e) => {
              if (!connected) return;
              sendMouseMove(e.clientX, e.clientY);
            }}
            onMouseDown={(e) => {
              if (!connected) return;
              e.preventDefault();
              sendMouseMove(e.clientX, e.clientY);
              const button = clampButton(e.button);
              queueInput({ k: "mouse_button", button, down: true });
            }}
            onMouseUp={(e) => {
              if (!connected) return;
              e.preventDefault();
              sendMouseMove(e.clientX, e.clientY);
              const button = clampButton(e.button);
              queueInput({ k: "mouse_button", button, down: false });
            }}
            onWheel={(e) => {
              if (!connected) return;
              e.preventDefault();
              sendMouseMove(e.clientX, e.clientY);
              queueInput({ k: "mouse_wheel", dx: e.deltaX, dy: e.deltaY });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
            }}
          >
            <video ref={videoRef} className="remote__video" playsInline />
            {!connected && (
              <div className="remote__overlay">
                <div className="remote__overlayText">Not connected</div>
              </div>
            )}
          </div>
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

function humanStatus(status: ConnectionStatus): string {
  if (status === "starting") return "Starting…";
  if (status === "connecting") return "Connecting…";
  if (status === "waiting_for_peer") return "Waiting for host…";
  if (status === "negotiating") return "Negotiating…";
  if (status === "connected") return "Connected";
  if (status === "disconnected") return "Disconnected";
  if (status === "error") return "Error";
  return "Idle";
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampButton(btn: number): 0 | 1 | 2 {
  if (btn === 0 || btn === 1 || btn === 2) return btn;
  return 0;
}

function computeVideoNormalizedCoords(params: {
  clientX: number;
  clientY: number;
  surface: HTMLDivElement | null;
  video: HTMLVideoElement | null;
}): { x: number; y: number } | null {
  const { clientX, clientY, surface, video } = params;
  if (!surface || !video) return null;
  const rect = surface.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    return { x, y };
  }

  const containerRatio = rect.width / rect.height;
  const videoRatio = vw / vh;

  let displayedWidth = rect.width;
  let displayedHeight = rect.height;
  let padX = 0;
  let padY = 0;

  if (containerRatio > videoRatio) {
    displayedHeight = rect.height;
    displayedWidth = rect.height * videoRatio;
    padX = (rect.width - displayedWidth) / 2;
  } else {
    displayedWidth = rect.width;
    displayedHeight = rect.width / videoRatio;
    padY = (rect.height - displayedHeight) / 2;
  }

  const x = clamp01((clientX - rect.left - padX) / displayedWidth);
  const y = clamp01((clientY - rect.top - padY) / displayedHeight);
  return { x, y };
}

function parseControlMessage(raw: unknown): ControlMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const t = (raw as { t?: unknown }).t;
  if (t === "host_info") {
    return raw as HostInfo;
  }
  return null;
}
