import { asString, isObject } from "../protocol/signaling";
import type { PersistedSettings } from "../types";

type TurnResponse = {
  iceServers: Array<{
    urls: string[] | string;
    username?: string;
    credential?: string;
  }>;
};

export function buildIceServers(settings: PersistedSettings): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stunUrl = settings.stunUrl.trim();
  if (stunUrl) servers.push({ urls: [stunUrl] });
  return servers;
}

export async function fetchTurnIceServers(settings: PersistedSettings): Promise<RTCIceServer[]> {
  if (!settings.useTurnFromSignaling) return [];
  const httpUrl = deriveHttpBase(settings.signalingUrl);
  if (!httpUrl) return [];

  const res = await fetch(`${httpUrl}/turn`);
  if (!res.ok) return [];
  const json = (await res.json()) as unknown;
  const parsed = parseTurnResponse(json);
  if (!parsed) return [];

  return parsed.iceServers.map((server) => ({
    urls: server.urls,
    username: server.username,
    credential: server.credential,
  }));
}

function deriveHttpBase(wsUrl: string): string | null {
  try {
    const u = new URL(wsUrl);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    u.pathname = "";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseTurnResponse(raw: unknown): TurnResponse | null {
  if (!isObject(raw)) return null;
  const iceServers = Array.isArray(raw.iceServers) ? raw.iceServers : null;
  if (!iceServers) return null;

  const parsedServers: TurnResponse["iceServers"] = [];
  for (const entry of iceServers) {
    if (!isObject(entry)) continue;
    const urlsRaw = entry.urls;
    const username = asString(entry.username) ?? undefined;
    const credential = asString(entry.credential) ?? undefined;
    const urls =
      typeof urlsRaw === "string"
        ? urlsRaw
        : Array.isArray(urlsRaw) && urlsRaw.every((u) => typeof u === "string")
          ? urlsRaw
          : null;
    if (!urls) continue;
    parsedServers.push({ urls, username, credential });
  }
  return { iceServers: parsedServers };
}

