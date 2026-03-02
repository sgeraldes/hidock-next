import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "../components/layout/AppLayout";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { SessionHeader } from "../components/SessionHeader";
import { SessionList } from "../components/SessionList";
import { RightPanel } from "../components/RightPanel";
import { AudioPlayer } from "../components/AudioPlayer";
import { useSessionStore } from "../store/useSessionStore";
import { useTranscriptStore } from "../store/useTranscriptStore";
import { useTranscriptionStream } from "../hooks/useTranscriptionStream";
import { useSettingsStore } from "../store/useSettingsStore";
import { useAudioCapture } from "../hooks/useAudioCapture";

function ActiveSessionRecorder({ sessionId }: { sessionId: string }) {
  const { start, stop, stopAndFlush } = useAudioCapture(sessionId);
  const setStopAndFlushRef = useSessionStore((s) => s.setStopAndFlushRef);

  useEffect(() => {
    // Register the flush function so App.tsx stop flow can call it
    setStopAndFlushRef(stopAndFlush);
    start();
    return () => {
      setStopAndFlushRef(null);
      stop();
    };
  }, [start, stop, stopAndFlush, setStopAndFlushRef]);

  return null;
}

const EMPTY_SEGMENTS: Array<{
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  sentiment: "positive" | "negative" | "neutral";
}> = [];

export default function Dashboard() {
  const [searchParams] = useSearchParams();

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const addSession = useSessionStore((s) => s.addSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const updateSessionStatus = useSessionStore((s) => s.updateSessionStatus);
  const switchView = useSessionStore((s) => s.switchView);
  const micActive = useSessionStore((s) => s.micActive);
  const setMicActive = useSessionStore((s) => s.setMicActive);
  const setLoading = useSessionStore((s) => s.setLoading);
  const setError = useSessionStore((s) => s.setError);
  const loading = useSessionStore((s) => s.loading);

  const viewingSession = viewingSessionId
    ? (sessions.get(viewingSessionId) ?? null)
    : null;

  const segmentMap = useTranscriptStore((s) => s.segments);
  const transcriptionError = useTranscriptStore((s) => s.transcriptionError);
  const setTranscriptionError = useTranscriptStore(
    (s) => s.setTranscriptionError,
  );
  const segments = viewingSessionId
    ? (segmentMap.get(viewingSessionId) ?? EMPTY_SEGMENTS)
    : EMPTY_SEGMENTS;

  const provider = useSettingsStore((s) => s.provider);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const isProviderConfigured = provider === "ollama" || Boolean(apiKey);

  useTranscriptionStream(viewingSessionId);

  useEffect(() => {
    const cleanupMicStatus = window.electronAPI.audio.onMicStatus(
      (status: { active: boolean }) => {
        setMicActive(status.active);
      },
    );
    return () => {
      cleanupMicStatus?.();
    };
  }, [setMicActive]);

  useEffect(() => {
    const cleanupError = window.electronAPI.transcription.onError(
      (error: string) => {
        setTranscriptionError(error);
        setTimeout(() => setTranscriptionError(null), 5000);
      },
    );
    return () => {
      cleanupError?.();
    };
  }, [setTranscriptionError]);

  useEffect(() => {
    setLoading(true);
    window.electronAPI.session
      .list()
      .then((sessionList) => {
        const list = sessionList as Array<{
          id: string;
          status: string;
          started_at: string;
          ended_at?: string | null;
          title?: string | null;
        }>;
        loadSessions(list);
        const active = list.find((s) => s.status === "active");
        if (active) {
          setActiveSession(active.id); // Fix UIS-007: Set active session ID
          switchView(active.id);
        } else if (list.length > 0) {
          const sorted = [...list].sort((a, b) =>
            b.started_at.localeCompare(a.started_at),
          );
          switchView(sorted[0].id);
        }
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to load sessions";
        setError(message);
      })
      .finally(() => {
        setLoading(false);
      });

    const cleanupCreated = window.electronAPI.session.onCreated((session) => {
      const s = session as {
        id: string;
        status: string;
        started_at: string;
        ended_at?: string | null;
        title?: string | null;
      };
      // Only register the session data. App.tsx's onStartRecording already calls
      // setActiveSession and switchView, so doing it here would cause a second
      // mount of ActiveSessionRecorder and a duplicate MediaRecorder instance.
      addSession(s);
    });

    const cleanupStatus = window.electronAPI.session.onStatusChanged((data) => {
      const { id, status } = data as { id: string; status: string };
      updateSessionStatus(id, status);
      if (status === "complete" || status === "inactive") {
        setActiveSession(null);
      }
    });

    return () => {
      cleanupCreated?.();
      cleanupStatus?.();
    };
  }, [
    loadSessions,
    addSession,
    setActiveSession,
    updateSessionStatus,
    switchView,
    setLoading,
    setError,
  ]);

  useEffect(() => {
    const sessionParam = searchParams.get("session");
    if (sessionParam) {
      switchView(sessionParam);
    }
  }, [searchParams, switchView]);

  return (
    <>
      {activeSessionId && <ActiveSessionRecorder sessionId={activeSessionId} />}
      {transcriptionError && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg bg-destructive px-4 py-3 text-sm text-destructive-foreground shadow-lg">
          {transcriptionError}
        </div>
      )}
      <AppLayout
        sidebar={<SessionList />}
        main={
          <div className="flex flex-col h-full">
            {/* Header Area */}
            <div className="border-b border-border bg-card px-6 py-4">
              <p className="text-sm text-muted-foreground">
                {sessions.size === 0
                  ? "No sessions"
                  : `${sessions.size} ${sessions.size === 1 ? "session" : "sessions"}`}
                {activeSessionId && " • Recording in progress"}
              </p>

              {settingsLoaded && !isProviderConfigured && (
                <div className="mt-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900">
                  <p className="text-sm text-amber-900 dark:text-amber-200">
                    <span className="font-medium">⚠️ Configure AI provider</span> —
                    Go to Settings to set up your transcription provider before recording.
                  </p>
                </div>
              )}
            </div>

            {loading && (
              <div className="flex items-center justify-center p-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="ml-3 text-sm text-muted-foreground">
                  Loading sessions...
                </span>
              </div>
            )}

            {!loading && (
              <>
                {viewingSession && (
                  <>
                    <SessionHeader
                      sessionTitle={viewingSession.title ?? null}
                      status={viewingSession.status}
                      startedAt={viewingSession.started_at}
                    />
                    {viewingSession.status !== "active" && (
                      <AudioPlayer sessionId={viewingSession.id} />
                    )}
                  </>
                )}
                <TranscriptPanel
                  segments={segments}
                  providerConfigured={isProviderConfigured}
                />
              </>
            )}
          </div>
        }
        rightPanel={<RightPanel />}
      />
    </>
  );
}
