import { useAudioControls } from '@/components/OperationController'
import { cn } from '@/lib/utils'
import { formatTimestamp } from '../utils/formatTimestamp'

interface TimeAnchorProps {
  /** Timestamp in seconds (simple API) */
  timestamp?: number
  /** Start time in milliseconds (TranscriptViewer API) */
  startMs?: number
  /** End time in milliseconds (TranscriptViewer API) */
  endMs?: number
  /** Whether this anchor is currently active/highlighted */
  isActive?: boolean
  /** Custom seek handler (TranscriptViewer API) */
  onSeek?: (startMs: number, endMs?: number) => void
  /** Simple click handler */
  onClick?: () => void
  children?: React.ReactNode
  className?: string
}

/**
 * TimeAnchor - Clickable timestamp component for transcripts
 *
 * Supports two APIs:
 * 1. Simple: timestamp (seconds) + optional onClick
 * 2. TranscriptViewer: startMs/endMs + onSeek callback
 *
 * @example
 * // Simple usage
 * <TimeAnchor timestamp={65} /> // Displays "1:05"
 *
 * // TranscriptViewer usage
 * <TimeAnchor startMs={65000} endMs={70000} onSeek={handleSeek} isActive={true} />
 */
export function TimeAnchor({
  timestamp,
  startMs,
  endMs,
  isActive,
  onSeek,
  onClick,
  children,
  className
}: TimeAnchorProps) {
  const { seek } = useAudioControls()

  // Determine the timestamp to display (prefer startMs if provided)
  const displaySeconds = startMs !== undefined ? startMs / 1000 : (timestamp ?? 0)

  const handleClick = () => {
    if (onSeek && startMs !== undefined) {
      // TranscriptViewer API: call onSeek with ms values
      onSeek(startMs, endMs)
    } else if (timestamp !== undefined) {
      // Simple API: use audio controls directly
      seek(timestamp)
    }
    onClick?.()
  }

  // Format timestamp as MM:SS or HH:MM:SS
  const formatted = formatTimestamp(displaySeconds)

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'text-primary hover:underline cursor-pointer font-mono text-sm',
        isActive && 'bg-primary/10 rounded px-1',
        className
      )}
      aria-label={`Jump to ${formatted}`}
      aria-current={isActive ? 'time' : undefined}
    >
      {children ?? formatted}
    </button>
  )
}
