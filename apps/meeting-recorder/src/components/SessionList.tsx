import { useSessionStore } from "../store/useSessionStore";
import { FileAudio, Circle } from "lucide-react";

interface SessionMeta {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  title?: string | null;
}

export function SessionList() {
  const sessions = useSessionStore((s) => s.sessions);
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const switchView = useSessionStore((s) => s.switchView);

  const sessionList = Array.from(sessions.values()).sort((a: SessionMeta, b: SessionMeta) => {
    const aTime = a.started_at || '';
    const bTime = b.started_at || '';
    return bTime.localeCompare(aTime);
  });

  return (
    <div className="flex flex-col h-full w-full bg-card border-r border-border">
      <div className="px-4 py-4 border-b border-border">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Recent Sessions
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {sessionList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <FileAudio className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              No sessions yet
            </p>
            <p className="text-xs text-muted-foreground">
              Start recording to create your first session
            </p>
          </div>
        )}
        {sessionList.map((session) => (
          <button
            key={session.id}
            onClick={() => switchView(session.id)}
            className={`w-full text-left px-3 py-3 mb-1 text-sm rounded-lg transition-colors ${
              viewingSessionId === session.id
                ? "bg-primary/10 border border-primary/20"
                : "hover:bg-accent border border-transparent"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="pt-0.5">
                {session.status === "active" ? (
                  <Circle className="w-3 h-3 text-red-500 fill-red-500 animate-pulse" />
                ) : (
                  <FileAudio className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate mb-0.5">
                  {session.title ?? `Session ${session.id.slice(0, 8)}`}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{session.status}</span>
                  <span>•</span>
                  <span>
                    {new Date(session.started_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
