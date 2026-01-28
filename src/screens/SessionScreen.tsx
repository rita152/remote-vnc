type Props = {
  connectionName: string;
  onEnd: () => void;
};

export default function SessionScreen({ connectionName, onEnd }: Props) {
  return (
    <div className="screen screen--session" aria-label={`Active session: ${connectionName}`}>
      <div className="remoteSurface" />

      <div className="toolbar" role="toolbar" aria-label="Session toolbar">
        <button type="button" className="toolbar__btn">
          KB
        </button>
        <button type="button" className="toolbar__btn">
          VIEW
        </button>
        <button type="button" className="toolbar__btn" onClick={onEnd}>
          END
        </button>
      </div>
    </div>
  );
}

