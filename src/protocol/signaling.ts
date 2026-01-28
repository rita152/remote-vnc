export type SignalingRole = "host" | "client";

export type JoinMessage = {
  type: "join";
  room: string;
  role: SignalingRole;
  token?: string;
};

export type LeaveMessage = {
  type: "leave";
};

export type SignalMessage = {
  type: "signal";
  data: unknown;
};

export type ClientToServerMessage = JoinMessage | LeaveMessage | SignalMessage;

export type JoinedMessage = {
  type: "joined";
  room: string;
  role: SignalingRole;
  peerPresent: boolean;
};

export type PeerJoinedMessage = {
  type: "peer_joined";
  role: SignalingRole;
};

export type PeerLeftMessage = {
  type: "peer_left";
  role: SignalingRole;
};

export type ServerSignalMessage = {
  type: "signal";
  from: SignalingRole;
  data: unknown;
};

export type ErrorMessage = {
  type: "error";
  code: string;
  message: string;
};

export type ServerToClientMessage =
  | JoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | ServerSignalMessage
  | ErrorMessage;

export function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseServerMessage(raw: unknown): ServerToClientMessage | null {
  if (!isObject(raw)) return null;
  const type = asString(raw.type);
  if (!type) return null;

  if (type === "joined") {
    const room = asString(raw.room);
    const role = asString(raw.role);
    const peerPresent = typeof raw.peerPresent === "boolean" ? raw.peerPresent : null;
    if (!room || (role !== "host" && role !== "client") || peerPresent === null) return null;
    return { type, room, role, peerPresent };
  }

  if (type === "peer_joined" || type === "peer_left") {
    const role = asString(raw.role);
    if (role !== "host" && role !== "client") return null;
    return { type, role };
  }

  if (type === "signal") {
    const from = asString(raw.from);
    if (from !== "host" && from !== "client") return null;
    return { type, from, data: raw.data };
  }

  if (type === "error") {
    const code = asString(raw.code);
    const message = asString(raw.message);
    if (!code || !message) return null;
    return { type, code, message };
  }

  return null;
}

