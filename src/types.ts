export type View = "connections" | "session" | "new";

export type ConnectionStatus = "online" | "offline";

export type Connection = {
  id: string;
  name: string;
  os: "M" | "W" | "L";
  status: ConnectionStatus;
};

export type NewConnectionDraft = {
  name: string;
  host: string;
  user: string;
};

