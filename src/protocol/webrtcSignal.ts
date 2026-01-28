import { asString, isObject } from "./signaling";

export type SignalPayload =
  | {
      kind: "description";
      description: RTCSessionDescriptionInit;
    }
  | {
      kind: "candidate";
      candidate: RTCIceCandidateInit;
    };

export function parseSignalPayload(raw: unknown): SignalPayload | null {
  if (!isObject(raw)) return null;
  const kind = asString(raw.kind);
  if (!kind) return null;

  if (kind === "description") {
    const description = isObject(raw.description) ? raw.description : null;
    if (!description) return null;
    const type = asString(description.type);
    const sdp = asString(description.sdp);
    if ((type !== "offer" && type !== "answer") || !sdp) return null;
    return { kind, description: { type, sdp } };
  }

  if (kind === "candidate") {
    const candidate = isObject(raw.candidate) ? raw.candidate : null;
    if (!candidate) return null;
    const cand = asString(candidate.candidate);
    if (!cand) return null;
    const sdpMid = typeof candidate.sdpMid === "string" ? candidate.sdpMid : null;
    const sdpMLineIndex =
      typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null;
    return { kind, candidate: { candidate: cand, sdpMid, sdpMLineIndex } };
  }

  return null;
}

