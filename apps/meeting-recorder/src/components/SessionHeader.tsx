interface SessionHeaderProps {
  sessionTitle: string | null;
  status: string;
  startedAt: string | null;
}

export function SessionHeader({
  sessionTitle,
  status,
  startedAt,
}: SessionHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
      <div className="flex items-center gap-2">
        {status === "active" && (
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        )}
        <h2 className="text-sm font-semibold text-foreground">
          {sessionTitle ?? "Untitled Session"}
        </h2>
      </div>
      <span className="text-xs text-muted-foreground capitalize">{status}</span>
      {startedAt && (
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(startedAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
