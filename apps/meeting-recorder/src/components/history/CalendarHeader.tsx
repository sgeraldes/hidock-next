import type { CalendarViewType } from "../../lib/calendar-utils";

interface CalendarHeaderProps {
  currentDate: Date;
  viewType: CalendarViewType;
  displayMode: "calendar" | "timeline";
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewTypeChange: (type: CalendarViewType) => void;
  onDisplayModeChange: (mode: "calendar" | "timeline") => void;
}

const VIEW_LABELS: Record<CalendarViewType, string> = {
  day: "Day",
  workweek: "Work Week",
  week: "Week",
  month: "Month",
};

export default function CalendarHeader({
  currentDate,
  viewType,
  displayMode,
  onPrev,
  onNext,
  onToday,
  onViewTypeChange,
  onDisplayModeChange,
}: CalendarHeaderProps) {
  const dateLabel = currentDate.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          &larr;
        </button>
        <button
          onClick={onToday}
          className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          Today
        </button>
        <button
          onClick={onNext}
          className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          &rarr;
        </button>
        <span className="ml-2 text-sm font-medium text-card-foreground">
          {dateLabel}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {displayMode === "calendar" && (
          <select
            value={viewType}
            onChange={(e) =>
              onViewTypeChange(e.target.value as CalendarViewType)
            }
            className="rounded border border-input bg-card px-2 py-1 text-xs text-card-foreground"
          >
            {Object.entries(VIEW_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        )}

        <div className="flex rounded border border-input">
          <button
            onClick={() => onDisplayModeChange("calendar")}
            className={`px-3 py-1 text-xs ${displayMode === "calendar" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"}`}
          >
            Calendar
          </button>
          <button
            onClick={() => onDisplayModeChange("timeline")}
            className={`px-3 py-1 text-xs ${displayMode === "timeline" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"}`}
          >
            Timeline
          </button>
        </div>
      </div>
    </div>
  );
}
