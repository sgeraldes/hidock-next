import { useEffect } from 'react'
import { Routes, Route, Outlet, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Sessions from './pages/Sessions'
import Notes from './pages/Notes'
import KnowledgeBase from './pages/KnowledgeBase'
import Settings from './pages/Settings'
import { Sidebar } from './components/shell/Sidebar'
import { Titlebar } from './components/shell/Titlebar'
import { KeyboardShortcuts } from './components/shell/KeyboardShortcuts'
import {
  initSessionStore,
  initTranscriptStore,
  initSuggestionStore,
  initNotesStore,
  initSettingsStore,
  initKnowledgeStore,
  initScreenshotStore,
} from './stores'
import { useMainNavigation } from './hooks'
import { useAudioCapture } from './hooks/use-audio-capture'
import { toast } from './hooks/use-toast'

const PAGE_NAMES: Record<string, string> = {
  '/': 'Dashboard',
  '/sessions': 'Sessions',
  '/notes': 'Notes',
  '/knowledge-base': 'Knowledge Base',
  '/settings': 'Settings',
}

function ShellLayout() {
  const location = useLocation()
  const pageName = PAGE_NAMES[location.pathname] ?? 'Meeting Assistant'

  // Listen for navigation requests from the main process (e.g. tray Settings click)
  useMainNavigation()

  useEffect(() => {
    const cleanups = [
      initSessionStore(),
      initTranscriptStore(),
      initSuggestionStore(),
      initNotesStore(),
      initSettingsStore(),
      initKnowledgeStore(),
      initScreenshotStore(),
    ]
    return () => cleanups.forEach((fn) => fn())
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <Titlebar pageName={pageName} />
        <main className="flex-1 min-w-0 min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>
      <KeyboardShortcuts />
    </div>
  )
}

export default function App() {
  // Mount audio capture hook at root so it is always active regardless of route
  const { error: audioError } = useAudioCapture()

  useEffect(() => {
    if (audioError) {
      toast({ title: 'Audio Capture Error', description: audioError, variant: 'destructive' })
    }
  }, [audioError])

  return (
    <Routes>
      <Route element={<ShellLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/knowledge-base" element={<KnowledgeBase />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
