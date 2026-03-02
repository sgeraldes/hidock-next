import React from "react";
import ReactDOM from "react-dom/client";
import { MiniControlBar } from "./components/MiniControlBar";
import "./globals.css";

function MiniControlBarApp() {
  const [isRecording, setIsRecording] = React.useState(false);
  const [elapsedTime, setElapsedTime] = React.useState(0);
  const [sessionTitle, setSessionTitle] = React.useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    window.electronAPI.session.onCreated((session: unknown) => {
      const s = session as { id: string; status: string };
      if (s.status === "active") {
        setIsRecording(true);
        setActiveSessionId(s.id);
        setSessionTitle(s.id.slice(0, 8));
      }
    });

    window.electronAPI.session.onStatusChanged((data: unknown) => {
      const d = data as { id: string; status: string };
      if (d.status === "inactive" || d.status === "complete") {
        if (d.id === activeSessionId) {
          setIsRecording(false);
        }
      }
    });
  }, [activeSessionId]);

  React.useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  return (
    <MiniControlBar
      isRecording={isRecording}
      elapsedTime={elapsedTime}
      sessionTitle={sessionTitle}
      sessions={[]}
      activeSessionId={activeSessionId}
      onEndRecording={async () => {
        if (activeSessionId) {
          console.log('[MiniControlBar] Stopping recording for session:', activeSessionId);
          const sessionToEnd = activeSessionId;
          // MiniControlBar doesn't own the recorder - give main window time to flush
          // The main window's ActiveSessionRecorder handles the actual stop+flush
          await new Promise((resolve) => setTimeout(resolve, 1500));
          window.electronAPI.session.end(sessionToEnd);
        }
      }}
      onSwitchSession={() => {}}
      onOpenMainWindow={() => {
        window.electronAPI.app.info();
      }}
      onCloseWindow={() => {
        window.electronAPI.window.closeControlBar();
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MiniControlBarApp />
  </React.StrictMode>,
);
