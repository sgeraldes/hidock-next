import { isSameDay } from "../../lib/calendar-utils";

interface SessionData {
  id: string;
  title: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  meeting_type_id: string | null;
  summary: string | null;
  created_at: string;
}

interface TimelineViewProps {
  sessions: SessionData[];
  onSessionClick: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function groupByDay(
  sessions: SessionData[],
): Array<{ date: string; sessions: SessionData[] }> {
  const groups: Array<{ date: string; sessions: SessionData[] }> = [];

  for (const session of sessions) {
    const sessionDate = new Date(session.started_at);
    const existing = groups.find((g) =>
      isSameDay(new Date(g.date), sessionDate),
    );

    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.push({ date: session.started_at, sessions: [session] });
    }
  }

  return groups;
}

function getDurationLabel(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "In progress";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
}

export default function TimelineView({
  sessions,
  onSessionClick,
  onSessionDelete,
}: TimelineViewProps) {
  if (sessions.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No sessions found
      </div>
    );
  }

  const groups = groupByDay(sessions);

  return (
    <div className="flex flex-col gap-6 p-4">
      {groups.map((group, gi) => (
        <div key={gi}>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            {formatDateHeader(group.date)}
          </h3>
          <div className="flex flex-col gap-2">
            {group.sessions.map((session) => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                onClick={() => onSessionClick(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSessionClick(session.id);
                  }
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left hover:border-input"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-card-foreground">
                    {session.title ?? "Untitled Session"}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {formatTime(session.started_at)}
                      {session.ended_at && ` – ${formatTime(session.ended_at)}`}
                    </span>
                    <span>
                      {getDurationLabel(session.started_at, session.ended_at)}
                    </span>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {session.status}
                </span>
                {onSessionDelete && (
                  <button
                    aria-label={`Delete session ${session.title ?? session.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSessionDelete(session.id);
                    }}
                    className="ml-2 rounded p-1 text-muted-foreground hover:bg-red-900/50 hover:text-red-400"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
