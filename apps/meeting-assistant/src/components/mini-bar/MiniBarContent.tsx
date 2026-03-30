import { Pause, Play, Camera, Square } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useSessionStore } from '../../stores/session-store'
import { useScreenshotStore } from '../../stores/screenshot-store'
import { useRecordingTimer } from '../../hooks/use-recording-timer'
import { useActiveSession } from '../../hooks/use-active-session'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

export function MiniBarContent() {
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const isRecording = useAppStore((s) => s.isRecording)
  const { session } = useActiveSession()

  const elapsed = useRecordingTimer(isRecording && session ? session.startedAt : null)

  const handlePauseResume = () => {
    // Pause/Resume is managed via session status; expose via IPC if available
    // For now this is a placeholder — session pause/resume depends on main process support
  }

  const handleScreenshot = () => {
    if (activeSessionId) {
      useScreenshotStore.getState().capture(activeSessionId)
    }
  }

  const handleEnd = () => {
    if (activeSessionId) {
      useSessionStore.getState().endSession(activeSessionId)
    }
  }

  const title = session?.title ?? 'Session'

  return (
    <div
      className={cn(
        'w-[400px] h-[60px]',
        'bg-sidebar rounded-lg shadow-overlay',
        'flex items-center px-3 gap-3',
        'border border-sidebar-border',
        'titlebar-drag-region',
      )}
    >
      {/* Status dot */}
      <div
        className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          isRecording
            ? 'bg-[hsl(var(--status-live))] animate-pulse'
            : 'bg-muted-foreground/40',
        )}
      />

      {/* Session info */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="font-sans text-xs font-medium text-sidebar-foreground truncate leading-none">
          {title}
        </span>
        <span className="font-mono text-[11px] text-sidebar-foreground/50 leading-none">
          {isRecording ? elapsed : '00:00:00'}
        </span>
      </div>

      {/* Quick actions */}
      <div className="titlebar-no-drag flex items-center gap-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={handlePauseResume}
          title={isRecording ? 'Pause' : 'Resume'}
          aria-label={isRecording ? 'Pause recording' : 'Resume recording'}
          disabled={!activeSessionId}
        >
          {isRecording ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={handleScreenshot}
          title="Screenshot"
          aria-label="Take screenshot"
          disabled={!activeSessionId || !isRecording}
        >
          <Camera className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-sidebar-foreground/70 hover:text-destructive hover:bg-sidebar-accent"
          onClick={handleEnd}
          title="End session"
          aria-label="End session"
          disabled={!activeSessionId || !isRecording}
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
