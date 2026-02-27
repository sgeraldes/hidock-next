interface SessionInfo {
  id: string;
  title: string | null;
  status: "active" | "inactive" | "processing" | "complete" | "interrupted";
}

interface MiniControlBarProps {
  isRecording: boolean;
  elapsedTime: number;
  sessionTitle: string | null;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onEndRecording: () => void;
  onSwitchSession: (sessionId: string) => void;
  onOpenMainWindow: () => void;
  onCloseWindow: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function MiniControlBar({
  isRecording,
  elapsedTime,
  sessionTitle,
  sessions,
  activeSessionId,
  onEndRecording,
  onSwitchSession,
  onOpenMainWindow,
  onCloseWindow,
}: MiniControlBarProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 bg-background text-foreground rounded-lg shadow-lg select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {isRecording && (
        <span
          data-testid="recording-indicator"
          className="w-3 h-3 rounded-full bg-red-500 animate-pulse"
        />
      )}

      <span className="text-sm font-mono tabular-nums">
        {formatTime(elapsedTime)}
      </span>

      {sessionTitle && (
        <span className="text-sm text-muted-foreground truncate max-w-[100px]">
          {sessionTitle}
        </span>
      )}

      {sessions.length > 0 && (
        <select
          data-testid="session-switcher"
          value={activeSessionId ?? ""}
          onChange={(e) => onSwitchSession(e.target.value)}
          className="text-xs bg-card text-card-foreground border border-input rounded px-1 py-0.5 max-w-[120px]"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title ?? "Untitled"}
            </option>
          ))}
        </select>
      )}

      <div
        className="flex items-center gap-1 ml-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {isRecording && (
          <button
            data-testid="stop-recording-btn"
            onClick={onEndRecording}
            className="p-1.5 rounded hover:bg-muted text-destructive"
            title="Stop Recording"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1" />
            </svg>
          </button>
        )}

        <button
          data-testid="open-main-btn"
          onClick={onOpenMainWindow}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
          title="Open Main Window"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <line x1="2" y1="5" x2="14" y2="5" />
          </svg>
        </button>

        <button
          data-testid="close-control-bar-btn"
          onClick={onCloseWindow}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
          title="Close Control Bar"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
