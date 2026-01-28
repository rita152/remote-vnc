import type { PersistedSettings } from "../types";

type Props = {
  settings: PersistedSettings;
  onChange: (next: PersistedSettings) => void;
  onStartHost: () => void;
  onStartClient: () => void;
  onGenerateRoom: () => void;
};

export default function HomeScreen({
  settings,
  onChange,
  onStartHost,
  onStartClient,
  onGenerateRoom,
}: Props) {
  return (
    <div className="screen screen--home">
      <div className="home">
        <header className="home__header">
          <h1 className="home__title">Remote Desktop</h1>
          <p className="home__subtitle">WebRTC + DataChannel + Native Input (Tauri)</p>
        </header>

        <section className="card" aria-label="Connection settings">
          <div className="card__row">
            <label className="field">
              <span className="field__label">Signaling WebSocket URL</span>
              <input
                className="field__input field__input--mono"
                value={settings.signalingUrl}
                onChange={(e) =>
                  onChange({ ...settings, signalingUrl: e.currentTarget.value })
                }
                spellCheck={false}
              />
              <span className="field__underline" aria-hidden="true" />
            </label>
          </div>

          <div className="card__row card__row--split">
            <label className="field">
              <span className="field__label">Room Code</span>
              <input
                className="field__input field__input--mono"
                value={settings.room}
                onChange={(e) => onChange({ ...settings, room: e.currentTarget.value })}
                spellCheck={false}
                inputMode="text"
              />
              <span className="field__underline" aria-hidden="true" />
            </label>

            <button type="button" className="secondaryButton" onClick={onGenerateRoom}>
              New Code
            </button>
          </div>

          <div className="card__row">
            <label className="field">
              <span className="field__label">STUN Server</span>
              <input
                className="field__input field__input--mono"
                value={settings.stunUrl}
                onChange={(e) => onChange({ ...settings, stunUrl: e.currentTarget.value })}
                spellCheck={false}
              />
              <span className="field__underline" aria-hidden="true" />
            </label>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.useTurnFromSignaling}
              onChange={(e) =>
                onChange({ ...settings, useTurnFromSignaling: e.currentTarget.checked })
              }
            />
            <span>Use TURN config from signaling server (`/turn`)</span>
          </label>
        </section>

        <section className="actions" aria-label="Start mode">
          <button type="button" className="primaryButton" onClick={onStartHost}>
            Host: Share Screen
          </button>
          <button type="button" className="primaryButton primaryButton--ghost" onClick={onStartClient}>
            Client: Control Remote
          </button>
        </section>

        <footer className="home__footer">
          <p className="muted">
            Tip: start the signaling server with{" "}
            <span className="mono">cargo run --bin signaling_server</span>
          </p>
        </footer>
      </div>
    </div>
  );
}

