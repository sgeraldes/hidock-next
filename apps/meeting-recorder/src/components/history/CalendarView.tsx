import {
  formatHourLabel,
  getHoursRange,
  getWeekDates,
  getMonthDates,
  isSameDay,
  formatDayHeader,
  getSessionTop,
  getSessionHeight,
  HOUR_HEIGHT,
  START_HOUR,
  END_HOUR,
} from "../../lib/calendar-utils";

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

interface CalendarViewProps {
  sessions: SessionData[];
  currentDate: Date;
  viewType: "day" | "workweek" | "week" | "month";
  onSessionClick: (sessionId: string) => void;
}

function DayColumn({
  date,
  sessions,
  onSessionClick,
}: {
  date: Date;
  sessions: SessionData[];
  onSessionClick: (id: string) => void;
}) {
  const daySessions = sessions.filter((s) =>
    isSameDay(new Date(s.started_at), date),
  );

  return (
    <div className="relative flex-1 border-l border-border">
      {daySessions.map((session) => {
        const top = getSessionTop(session.started_at);
        const height = getSessionHeight(session.started_at, session.ended_at);

        return (
          <button
            key={session.id}
            onClick={() => onSessionClick(session.id)}
            className="absolute left-1 right-1 overflow-hidden rounded bg-primary/80 px-2 py-1 text-left text-xs text-white hover:bg-primary/90"
            style={{ top: `${top}px`, height: `${height}px` }}
          >
            {session.title ?? "Untitled Session"}
          </button>
        );
      })}
    </div>
  );
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthGrid({
  sessions,
  currentDate,
  onSessionClick,
}: {
  sessions: SessionData[];
  currentDate: Date;
  onSessionClick: (id: string) => void;
}) {
  const dates = getMonthDates(currentDate);
  const currentMonth = currentDate.getMonth();

  const weeks: Date[][] = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7));
  }

  return (
    <div className="flex flex-col">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="px-2 py-1 text-center text-xs font-medium text-muted-foreground"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-border">
          {week.map((day, di) => {
            const isCurrentMonth = day.getMonth() === currentMonth;
            const daySessions = sessions.filter((s) =>
              isSameDay(new Date(s.started_at), day),
            );

            return (
              <div
                key={di}
                className={`min-h-[80px] border-r border-border p-1 ${
                  isCurrentMonth ? "bg-background" : "bg-background/50"
                }`}
              >
                <div
                  className={`mb-1 text-xs ${
                    isCurrentMonth ? "text-muted-foreground" : "text-muted-foreground"
                  }`}
                >
                  {day.getDate()}
                </div>
                <div className="flex flex-col gap-0.5">
                  {daySessions.slice(0, 3).map((session) => (
                    <button
                      key={session.id}
                      onClick={() => onSessionClick(session.id)}
                      className="truncate rounded bg-primary/60 px-1 py-0.5 text-left text-[10px] text-white hover:bg-primary/90/80"
                    >
                      {session.title ?? "Untitled"}
                    </button>
                  ))}
                  {daySessions.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{daySessions.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function CalendarView({
  sessions,
  currentDate,
  viewType,
  onSessionClick,
}: CalendarViewProps) {
  if (viewType === "month") {
    return (
      <MonthGrid
        sessions={sessions}
        currentDate={currentDate}
        onSessionClick={onSessionClick}
      />
    );
  }

  const hours = getHoursRange();
  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  const getDayColumns = (): Date[] => {
    if (viewType === "day") return [currentDate];
    if (viewType === "workweek") return getWeekDates(currentDate).slice(0, 5);
    return getWeekDates(currentDate);
  };

  const dayColumns = getDayColumns();
  const showDayHeaders = viewType !== "day";

  return (
    <div className="flex flex-col">
      {showDayHeaders && (
        <div className="flex border-b border-border">
          <div className="w-16 shrink-0" />
          {dayColumns.map((d, i) => (
            <div
              key={i}
              className="flex-1 border-l border-border px-2 py-1 text-center text-xs text-muted-foreground"
            >
              {formatDayHeader(d)}
            </div>
          ))}
        </div>
      )}

      <div className="relative flex overflow-y-auto">
        {/* Hour labels */}
        <div className="w-16 shrink-0" style={{ height: `${totalHeight}px` }}>
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-2 text-xs text-muted-foreground"
              style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
            >
              {formatHourLabel(h)}
            </div>
          ))}
        </div>

        {/* Day columns with sessions */}
        <div
          className="relative flex flex-1"
          style={{ height: `${totalHeight}px` }}
        >
          {/* Hour grid lines */}
          {hours.map((h) => (
            <div
              key={`line-${h}`}
              className="pointer-events-none absolute left-0 right-0 border-t border-border"
              style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
            />
          ))}

          {dayColumns.map((d, i) => (
            <DayColumn
              key={i}
              date={d}
              sessions={sessions}
              onSessionClick={onSessionClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
