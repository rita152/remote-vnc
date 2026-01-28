export type Role = "host" | "client";

export type PersistedSettings = {
  signalingUrl: string;
  room: string;
  stunUrl: string;
  useTurnFromSignaling: boolean;
};

export type ConnectionStatus =
  | "idle"
  | "starting"
  | "connecting"
  | "waiting_for_peer"
  | "negotiating"
  | "connected"
  | "disconnected"
  | "error";

export type SessionError = {
  message: string;
  cause?: unknown;
};

