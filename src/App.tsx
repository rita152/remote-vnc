import { useMemo, useState } from "react";
import { generateRoomCode } from "./lib/room";
import { useLocalStorageState } from "./lib/useLocalStorageState";
import ClientScreen from "./screens/ClientScreen";
import HomeScreen from "./screens/HomeScreen";
import HostScreen from "./screens/HostScreen";
import type { PersistedSettings, Role } from "./types";

function App() {
  const defaultSettings = useMemo<PersistedSettings>(
    () => ({
      signalingUrl: "ws://localhost:8080/ws",
      room: generateRoomCode(),
      stunUrl: "stun:stun.l.google.com:19302",
      useTurnFromSignaling: false,
    }),
    [],
  );

  const [settings, setSettings] = useLocalStorageState<PersistedSettings>(
    "remote-vnc:settings",
    defaultSettings,
  );

  const [role, setRole] = useState<Role | null>(null);

  return (
    <div className="app" data-role={role ?? "none"}>
      {!role && (
        <HomeScreen
          settings={settings}
          onChange={setSettings}
          onGenerateRoom={() => setSettings({ ...settings, room: generateRoomCode() })}
          onStartHost={() => setRole("host")}
          onStartClient={() => setRole("client")}
        />
      )}

      {role === "host" && (
        <HostScreen settings={settings} onBack={() => setRole(null)} />
      )}

      {role === "client" && (
        <ClientScreen settings={settings} onBack={() => setRole(null)} />
      )}
    </div>
  );
}

export default App;
