import { useEffect, useState } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Settings from "./pages/Settings";
import { NavSidebar } from "./components/layout/NavSidebar";
import TopBar from "./components/layout/TopBar";
import { useSettingsStore } from "./store/useSettingsStore";
import { useSessionStore } from "./store/useSessionStore";
import { useElapsedTime } from "./hooks/useElapsedTime";
import { RecordingProvider } from "./contexts/RecordingContext";

function ThemeProvider() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      if (prefersDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  }, [theme]);

  return null;
}

function ShellLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const micActive = useSessionStore((s) => s.micActive);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const addSession = useSessionStore((s) => s.addSession);
  const switchView = useSessionStore((s) => s.switchView);

  const autoRecord = useSettingsStore((s) => s.autoRecord);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const provider = useSettingsStore((s) => s.provider);
  const saveToIPC = useSettingsStore((s) => s.saveToIPC);
  const setField = useSettingsStore((s) => s.setField);
  const loadFromIPC = useSettingsStore((s) => s.loadFromIPC);

  const isProviderConfigured = provider === "ollama" || Boolean(apiKey);
  const elapsedTime = useElapsedTime(activeSessionId !== null);

  // Load settings from Electron on mount
  useEffect(() => {
    loadFromIPC();
  }, [loadFromIPC]);

  const recordingContextValue = {
    isRecording: activeSessionId !== null,
    elapsedTime,
    micActive,
    autoRecord,
    onStartRecording: async () => {
      if (isProviderConfigured) {
        try {
          const session = (await window.electronAPI.session.create()) as {
            id: string;
            status: string;
            started_at: string;
          };
          addSession(session);
          setActiveSession(session.id);
          switchView(session.id);
        } catch (error) {
          console.error("[App] Failed to create session:", error);
          // TODO: Show user-facing error notification
          alert(
            `Failed to start recording: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    },
    onStopRecording: () => {
      if (activeSessionId) {
        window.electronAPI.session.end(activeSessionId);
        setActiveSession(null);
      }
    },
    onToggleAutoRecord: () => {
      const next = !autoRecord;
      setField("autoRecord", next);
      saveToIPC("recording.autoRecord", String(next));
    },
  };

  return (
    <RecordingProvider value={recordingContextValue}>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
        <TopBar onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
          <NavSidebar collapsed={sidebarCollapsed} />
          <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
            <Outlet />
          </div>
        </div>
      </div>
    </RecordingProvider>
  );
}

export default function App() {
  return (
    <>
      <ThemeProvider />
      <Routes>
        <Route element={<ShellLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  );
}
