import { useState } from "react";
import { FolderOpen, Trash2, FileX, RefreshCw } from "lucide-react";
import { useSessionStore } from "../store/useSessionStore";
import { useTranscriptStore } from "../store/useTranscriptStore";
import { showNotification } from "./NotificationToast";

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
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const switchView = useSessionStore((s) => s.switchView);
  const clearTranscriptSession = useTranscriptStore((s) => s.clearSession);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isActive = status === "active";

  const handleOpenLocation = async () => {
    if (!viewingSessionId) return;
    try {
      await window.electronAPI.session.openFileLocation(viewingSessionId);
    } catch (err) {
      showNotification("error", "Failed to open file location");
    }
  };

  const handleDeleteSession = async () => {
    if (!viewingSessionId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    try {
      await window.electronAPI.session.delete(viewingSessionId);
      clearTranscriptSession(viewingSessionId);
      // Reload session list
      const sessionList = await window.electronAPI.session.list() as Array<{
        id: string; status: string; started_at: string;
        ended_at?: string | null; title?: string | null;
      }>;
      loadSessions(sessionList);
      // Switch to most recent remaining session
      if (sessionList.length > 0) {
        const sorted = [...sessionList].sort((a, b) =>
          b.started_at.localeCompare(a.started_at),
        );
        switchView(sorted[0].id);
      }
      showNotification("success", "Session deleted");
    } catch (err) {
      showNotification("error", "Failed to delete session");
    }
    setConfirmDelete(false);
  };

  const handleDeleteTranscript = async () => {
    if (!viewingSessionId) return;
    try {
      await window.electronAPI.session.deleteTranscript(viewingSessionId);
      clearTranscriptSession(viewingSessionId);
      showNotification("success", "Transcript deleted");
    } catch (err) {
      showNotification("error", "Failed to delete transcript");
    }
  };

  const handleRetranscribe = async () => {
    if (!viewingSessionId) return;
    try {
      clearTranscriptSession(viewingSessionId);
      await window.electronAPI.session.retranscribe(viewingSessionId);
      showNotification("success", "Re-transcription started");
    } catch (err) {
      showNotification("error", "Failed to start re-transcription");
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
      <div className="flex items-center gap-2">
        {isActive && (
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        )}
        <h2 className="text-sm font-semibold text-foreground">
          {sessionTitle ?? "Untitled Session"}
        </h2>
      </div>
      <span className="text-xs text-muted-foreground capitalize">{status}</span>
      {startedAt && (
        <span className="text-xs text-muted-foreground">
          {new Date(startedAt).toLocaleTimeString()}
        </span>
      )}

      {!isActive && viewingSessionId && (
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={handleOpenLocation}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Open file location"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={handleRetranscribe}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Re-generate transcription"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleDeleteTranscript}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Delete transcription"
          >
            <FileX className="w-4 h-4" />
          </button>
          <button
            onClick={handleDeleteSession}
            className={`p-1.5 rounded-md transition-colors ${
              confirmDelete
                ? "text-destructive bg-destructive/10 hover:bg-destructive/20"
                : "text-muted-foreground hover:text-destructive hover:bg-accent"
            }`}
            title={confirmDelete ? "Click again to confirm delete" : "Delete session"}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {isActive && (
        <span className="text-xs text-muted-foreground ml-auto">
          {startedAt && new Date(startedAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
