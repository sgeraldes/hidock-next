interface RecordingControlsProps {
  isRecording: boolean;
  elapsedTime: number;
  micActive: boolean;
  autoRecord: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onToggleAutoRecord: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function RecordingControls({
  isRecording,
  elapsedTime,
  micActive,
  autoRecord,
  onStartRecording,
  onStopRecording,
  onToggleAutoRecord,
}: RecordingControlsProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-2">
        {isRecording ? (
          <button
            data-testid="stop-recording"
            onClick={onStopRecording}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="10" height="10" rx="1" />
            </svg>
            Stop
          </button>
        ) : (
          <button
            data-testid="start-recording"
            onClick={onStartRecording}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <circle cx="7" cy="7" r="5" />
            </svg>
            Record
          </button>
        )}
      </div>

      {isRecording && (
        <span className="text-sm font-mono tabular-nums text-foreground">
          {formatTime(elapsedTime)}
        </span>
      )}

      <div
        data-testid="mic-indicator"
        className={`w-2.5 h-2.5 rounded-full ${micActive ? "bg-green-500" : "bg-muted-foreground/50"}`}
        title={micActive ? "Mic active" : "Mic inactive"}
      />

      <label className="flex items-center gap-2 ml-auto cursor-pointer">
        <span className="text-xs text-muted-foreground">Auto-record</span>
        <button
          data-testid="auto-record-toggle"
          onClick={onToggleAutoRecord}
          className={`relative w-8 h-4 rounded-full transition-colors ${autoRecord ? "bg-green-500" : "bg-muted-foreground/50"}`}
          role="switch"
          aria-checked={autoRecord}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoRecord ? "translate-x-4" : ""}`}
          />
        </button>
      </label>
    </div>
  );
}
