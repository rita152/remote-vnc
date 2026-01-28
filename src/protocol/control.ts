export type ProtocolVersion = 1;

export type ControlHello = {
  t: "hello";
  protocol: ProtocolVersion;
  role: "host" | "client";
  name?: string;
};

export type HostInfo = {
  t: "host_info";
  protocol: ProtocolVersion;
  capture: {
    width: number;
    height: number;
    frameRate?: number;
  };
};

export type ControlPing = {
  t: "ping";
  id: number;
  ts: number;
};

export type ControlPong = {
  t: "pong";
  id: number;
  ts: number;
};

export type MouseButton = 0 | 1 | 2;

export type InputMouseMove = {
  k: "mouse_move";
  x: number; // normalized [0..1]
  y: number; // normalized [0..1]
};

export type InputMouseButton = {
  k: "mouse_button";
  button: MouseButton;
  down: boolean;
};

export type InputMouseWheel = {
  k: "mouse_wheel";
  dx: number;
  dy: number;
};

export type InputKey = {
  k: "key";
  code: string;
  down: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

export type InputEvent = InputMouseMove | InputMouseButton | InputMouseWheel | InputKey;

export type ControlInput = {
  t: "input";
  events: InputEvent[];
};

export type ControlMessage = ControlHello | HostInfo | ControlPing | ControlPong | ControlInput;

