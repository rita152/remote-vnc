import type { NewConnectionDraft } from "../types";

type Props = {
  draft: NewConnectionDraft;
  onChange: (next: NewConnectionDraft) => void;
  onCancel: () => void;
  onConnect: (next: NewConnectionDraft) => void;
};

export default function NewConnectionScreen({
  draft,
  onChange,
  onCancel,
  onConnect,
}: Props) {
  return (
    <div
      className="screen screen--new"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="New Connection">
        <h2 className="modal__title">New Connection</h2>

        <Field
          label="Name"
          value={draft.name}
          onChange={(name) => onChange({ ...draft, name })}
          autoFocus
        />
        <Field
          label="Host"
          value={draft.host}
          onChange={(host) => onChange({ ...draft, host })}
        />
        <Field
          label="User"
          value={draft.user}
          onChange={(user) => onChange({ ...draft, user })}
        />

        <button type="button" className="primaryButton" onClick={() => onConnect(draft)}>
          Connect
        </button>
      </div>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
};

function Field({ label, value, onChange, autoFocus }: FieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      <span className="field__underline" aria-hidden="true" />
    </label>
  );
}
