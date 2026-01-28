import type { Connection } from "../types";

type Props = {
  connections: Connection[];
  onConnect: (id: string) => void;
};

export default function ConnectionsScreen({ connections, onConnect }: Props) {
  return (
    <div className="screen screen--connections">
      <div className="connections">
        <header className="connections__header">
          <h1 className="connections__title">Connections</h1>
          <p className="connections__subtitle">{connections.length} saved machines</p>
        </header>

        <section className="connections__list" aria-label="Connections list">
          {connections.map((c) => (
            <button
              key={c.id}
              type="button"
              className="connectionItem"
              data-status={c.status}
              onClick={() => onConnect(c.id)}
            >
              <span className="osIcon" aria-hidden="true">
                <span className="osLetter">{c.os}</span>
              </span>
              <span className="connectionName">{c.name}</span>
              <span className="spacer" aria-hidden="true" />
              <span className="statusDot" data-status={c.status} aria-hidden="true" />
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
