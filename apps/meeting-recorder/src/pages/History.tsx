import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useHistoryStore } from "../store/useHistoryStore";
import CalendarView from "../components/history/CalendarView";
import TimelineView from "../components/history/TimelineView";
import CalendarHeader from "../components/history/CalendarHeader";
import SessionSearch from "../components/history/SessionSearch";

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

export default function History() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionData[]>([]);

  const displayMode = useHistoryStore((s) => s.displayMode);
  const calendarViewType = useHistoryStore((s) => s.calendarViewType);
  const currentDate = useHistoryStore((s) => s.currentDate);
  const searchQuery = useHistoryStore((s) => s.searchQuery);
  const setDisplayMode = useHistoryStore((s) => s.setDisplayMode);
  const setCalendarViewType = useHistoryStore((s) => s.setCalendarViewType);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const navigatePrev = useHistoryStore((s) => s.navigatePrev);
  const navigateNext = useHistoryStore((s) => s.navigateNext);
  const navigateToday = useHistoryStore((s) => s.navigateToday);

  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const loadSessions = useCallback((query: string = "") => {
    window.electronAPI.history
      .search(query)
      .then((list) => {
        setSessions(list as SessionData[]);
      })
      .catch((err) => {
        console.warn("[History] Failed to load sessions:", err);
      });
  }, []);

  useEffect(() => {
    loadSessions(searchQuery);
  }, [searchQuery, loadSessions]);

  useEffect(() => {
    const cleanup = window.electronAPI.session.onStatusChanged(() => {
      loadSessions(searchQueryRef.current);
    });
    return cleanup;
  }, [loadSessions]);

  const filteredSessions = sessions;

  const handleSessionClick = (sessionId: string) => {
    navigate(`/?session=${sessionId}`);
  };

  const handleSessionDelete = (sessionId: string) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this session? This cannot be undone.",
    );
    if (!confirmed) return;
    window.electronAPI.history
      .delete(sessionId)
      .then(() => {
        loadSessions(searchQuery);
      })
      .catch((err) => {
        console.warn("[History] Failed to delete session:", err);
      });
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <CalendarHeader
        currentDate={new Date(currentDate)}
        viewType={calendarViewType}
        displayMode={displayMode}
        onPrev={navigatePrev}
        onNext={navigateNext}
        onToday={navigateToday}
        onViewTypeChange={setCalendarViewType}
        onDisplayModeChange={setDisplayMode}
      />

      <SessionSearch query={searchQuery} onQueryChange={setSearchQuery} />

      <div className="flex-1 overflow-y-auto">
        {displayMode === "calendar" ? (
          <CalendarView
            sessions={filteredSessions}
            currentDate={new Date(currentDate)}
            viewType={calendarViewType}
            onSessionClick={handleSessionClick}
          />
        ) : (
          <TimelineView
            sessions={filteredSessions}
            onSessionClick={handleSessionClick}
            onSessionDelete={handleSessionDelete}
          />
        )}
      </div>
    </div>
  );
}
