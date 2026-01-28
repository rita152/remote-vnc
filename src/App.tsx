import { useEffect, useMemo, useState } from "react";
import ConnectionsScreen from "./screens/ConnectionsScreen";
import NewConnectionScreen from "./screens/NewConnectionScreen";
import SessionScreen from "./screens/SessionScreen";
import type { Connection, NewConnectionDraft, View } from "./types";

function App() {
  const [connections, setConnections] = useState<Connection[]>(() => [
    { id: "mac-studio", name: "Mac Studio", os: "M", status: "online" },
    { id: "workstation", name: "Workstation", os: "W", status: "offline" },
    { id: "render-node", name: "Render Node", os: "L", status: "online" },
    { id: "windows-vm", name: "Windows VM", os: "W", status: "offline" },
  ]);

  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    null,
  );

  const defaultDraft = useMemo<NewConnectionDraft>(
    () => ({
      name: "Mac Studio",
      host: "192.168.1.24",
      user: "admin",
    }),
    [],
  );

  const [draft, setDraft] = useState<NewConnectionDraft>(defaultDraft);
  const [view, setView] = useState<View>(() => viewFromHash());

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        navigate("connections");
      }
      if (view === "connections" && (e.key === "n" || e.key === "N")) {
        setDraft(defaultDraft);
        navigate("new");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  function navigate(next: View) {
    window.location.hash = `#/${next}`;
    setView(next);
  }

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) ?? null,
    [activeConnectionId, connections],
  );

  return (
    <div className="app" data-view={view}>
      {view === "connections" && (
        <ConnectionsScreen
          connections={connections}
          onConnect={(id) => {
            setActiveConnectionId(id);
            navigate("session");
          }}
        />
      )}

      {view === "session" && (
        <SessionScreen
          connectionName={activeConnection?.name ?? "Session"}
          onEnd={() => navigate("connections")}
        />
      )}

      {view === "new" && (
        <NewConnectionScreen
          draft={draft}
          onChange={setDraft}
          onCancel={() => navigate("connections")}
          onConnect={(next) => {
            const id = next.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            setConnections((prev) => [
              { id, name: next.name, os: "M", status: "online" },
              ...prev,
            ]);
            setActiveConnectionId(id);
            navigate("session");
          }}
        />
      )}
    </div>
  );
}

function viewFromHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (raw === "session" || raw === "new" || raw === "connections") return raw;
  return "connections";
}

export default App;
