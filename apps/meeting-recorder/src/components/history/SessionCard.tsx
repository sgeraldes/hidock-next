interface SessionCardProps {
  title: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  meetingType?: string;
  onClick: () => void;
}

export default function SessionCard({
  title,
  status,
  startedAt,
  endedAt,
  meetingType,
  onClick,
}: SessionCardProps) {
  const start = new Date(startedAt);
  const timeStr = start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  let duration = "";
  if (endedAt) {
    const ms = new Date(endedAt).getTime() - start.getTime();
    const min = Math.round(ms / 60000);
    duration = min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
  }

  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-1 rounded border border-border bg-card p-3 text-left hover:border-input"
    >
      <div className="text-sm font-medium text-card-foreground">
        {title ?? "Untitled Session"}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{timeStr}</span>
        {duration && <span>{duration}</span>}
        {meetingType && (
          <span className="rounded bg-muted px-1.5 py-0.5">
            {meetingType}
          </span>
        )}
        <span className="rounded-full bg-muted px-1.5 py-0.5">{status}</span>
      </div>
    </button>
  );
}
