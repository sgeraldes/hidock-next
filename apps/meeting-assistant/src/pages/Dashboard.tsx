import { useEffect } from 'react'
import { Mic, MicOff, Camera, Square, LayoutDashboard } from 'lucide-react'
import { useAppStore } from '../stores/app-store'
import { useSessionStore } from '../stores/session-store'
import { useTranscriptStore } from '../stores/transcript-store'
import { useSuggestionStore } from '../stores/suggestion-store'
import { useScreenshotStore } from '../stores/screenshot-store'
import { useActiveSession } from '../hooks/use-active-session'
import { useRecordingTimer } from '../hooks/use-recording-timer'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { TranscriptViewer } from '../components/transcript/TranscriptViewer'
import { SuggestionList } from '../components/suggestions/SuggestionList'
import { ScreenshotGallery } from '../components/screenshots/ScreenshotGallery'

// ── Quick-stat metric card ────────────────────────────────────────────────────

interface MetricCardProps {
  label: string
  value: string | number
  mono?: boolean
}

function MetricCard({ label, value, mono }: MetricCardProps) {
  return (
    <Card className="flex-1 min-w-0">
      <CardContent className="py-3 flex flex-col items-center gap-0.5">
        <span className={mono ? 'font-mono text-2xl font-bold text-foreground' : 'font-mono text-2xl font-bold text-foreground'}>
          {value}
        </span>
        <span className="text-[11px] font-sans text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </CardContent>
    </Card>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTotalDuration(sessions: { startedAt: number; endedAt: number | null }[]): string {
  const totalMs = sessions.reduce((acc, s) => {
    if (s.endedAt) return acc + (s.endedAt - s.startedAt)
    return acc
  }, 0)
  const totalSecs = Math.floor(totalMs / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── Welcome State ─────────────────────────────────────────────────────────────

interface WelcomeStateProps {
  sessions: { startedAt: number; endedAt: number | null }[]
  onStart: () => void
  isCreating: boolean
}

function WelcomeState({ sessions, onStart, isCreating }: WelcomeStateProps) {
  const completedSessions = sessions.filter((s) => s.endedAt !== null)

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-8 min-h-0 py-12">
      {/* Hero */}
      <div className="flex flex-col items-center gap-3 text-center max-w-md">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-1">
          <LayoutDashboard className="w-8 h-8 text-primary" />
        </div>
        <h1 className="font-display text-3xl font-bold text-foreground tracking-tight">
          Ready to Record
        </h1>
        <p className="font-sans text-sm text-muted-foreground leading-relaxed">
          Start a new session or wait for a meeting to begin
        </p>
      </div>

      {/* CTA */}
      <Button variant="primary" size="lg" onClick={onStart} disabled={isCreating}>
        <Mic className="w-4 h-4" />
        {isCreating ? 'Starting…' : 'Start Recording'}
      </Button>

      {/* Quick stats */}
      {sessions.length > 0 && (
        <div className="flex gap-3 w-full max-w-sm mt-2">
          <MetricCard label="Sessions" value={sessions.length} />
          <MetricCard label="Total time" value={completedSessions.length > 0 ? formatTotalDuration(completedSessions) : '—'} mono />
        </div>
      )}
    </div>
  )
}

// ── Active Session State ───────────────────────────────────────────────────────

interface ActiveSessionStateProps {
  sessionId: string
  sessionTitle: string
  sessionStartedAt: number
  onPause: () => void
  onScreenshot: () => void
  onEnd: () => void
}

function ActiveSessionState({
  sessionId,
  sessionTitle,
  sessionStartedAt,
  onPause,
  onScreenshot,
  onEnd,
}: ActiveSessionStateProps) {
  const elapsed = useRecordingTimer(sessionStartedAt)

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Session header */}
      <div className="flex items-center gap-3 shrink-0">
        <Badge variant="live" className="animate-pulse-live">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-status-live" />
          LIVE
        </Badge>
        <h1 className="font-display text-lg font-semibold text-foreground flex-1 truncate">
          {sessionTitle}
        </h1>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">{elapsed}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* Transcript — left/main */}
        <div className="flex-[2] min-h-0 min-w-0 rounded-lg border border-border bg-card overflow-hidden">
          <TranscriptViewer sessionId={sessionId} sessionStartedAt={sessionStartedAt} />
        </div>

        {/* Suggestions — right/secondary */}
        <div className="flex-1 min-h-0 min-w-0 rounded-lg border border-border bg-card overflow-y-auto">
          <div className="px-3 py-2 border-b border-border/50">
            <span className="text-[11px] font-medium font-sans uppercase tracking-wider text-muted-foreground">
              Suggestions
            </span>
          </div>
          <SuggestionList sessionId={sessionId} />
        </div>
      </div>

      {/* Quick action bar */}
      <div className="flex items-center gap-2 shrink-0 pt-1">
        <Button variant="secondary" size="sm" onClick={onPause}>
          <MicOff className="w-3.5 h-3.5" />
          Pause
        </Button>
        <Button variant="secondary" size="sm" onClick={onScreenshot}>
          <Camera className="w-3.5 h-3.5" />
          Screenshot
        </Button>
        <div className="flex-1" />
        <Button variant="destructive" size="sm" onClick={onEnd}>
          <Square className="w-3.5 h-3.5" />
          End Session
        </Button>
      </div>

      {/* Screenshot gallery */}
      <div className="shrink-0 rounded-lg border border-border bg-card p-3">
        <ScreenshotGallery sessionId={sessionId} />
      </div>
    </div>
  )
}

// ── Dashboard Page ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { session, isActive } = useActiveSession()
  const sessions = useSessionStore((s) => s.sessions)
  const loading = useSessionStore((s) => s.loading)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const createSession = useSessionStore((s) => s.createSession)
  const endSession = useSessionStore((s) => s.endSession)
  const captureScreenshot = useScreenshotStore((s) => s.capture)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const fetchSegments = useTranscriptStore((s) => s.fetchSegments)
  const fetchActiveSuggestions = useSuggestionStore((s) => s.fetchActive)

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // When there's an active session, load its transcript and suggestions
  useEffect(() => {
    if (session) {
      fetchSegments(session.id)
      fetchActiveSuggestions(session.id)
    }
  }, [session?.id, fetchSegments, fetchActiveSuggestions])

  async function handleStartRecording() {
    const newSession = await createSession()
    if (newSession) {
      setActiveSession(newSession.id)
    }
  }

  async function handleEndSession() {
    if (session) {
      await endSession(session.id)
      setActiveSession(null)
    }
  }

  function handleScreenshot() {
    if (session) {
      captureScreenshot(session.id)
    }
  }

  function handlePause() {
    // Pause is a future feature — placeholder
  }

  return (
    <div className="flex flex-col h-full p-6 min-h-0">
      {isActive && session ? (
        <ActiveSessionState
          sessionId={session.id}
          sessionTitle={session.title}
          sessionStartedAt={session.startedAt}
          onPause={handlePause}
          onScreenshot={handleScreenshot}
          onEnd={handleEndSession}
        />
      ) : (
        <WelcomeState
          sessions={sessions}
          onStart={handleStartRecording}
          isCreating={loading}
        />
      )}
    </div>
  )
}
