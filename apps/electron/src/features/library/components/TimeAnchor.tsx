import { useAudioControls } from '@/components/OperationController'
import { cn } from '@/lib/utils'
import { formatTimestamp } from '../utils/formatTimestamp'

interface TimeAnchorProps {
  timestamp: number // seconds
  children?: React.ReactNode
  className?: string
  onClick?: () => void
}

/**
 * TimeAnchor - Clickable timestamp component for transcripts
 *
 * When clicked, seeks the audio player to the specified timestamp.
 * Displays as a formatted timestamp (MM:SS or HH:MM:SS) or custom content.
 *
 * @example
 * <TimeAnchor timestamp={65} /> // Displays "1:05"
 * <TimeAnchor timestamp={3665}>Go to hour mark</TimeAnchor> // Custom content
 */
export function TimeAnchor({ timestamp, children, className, onClick }: TimeAnchorProps) {
  const { seek } = useAudioControls()

  const handleClick = () => {
    seek(timestamp)
    onClick?.()
  }

  // Format timestamp as MM:SS or HH:MM:SS
  const formatted = formatTimestamp(timestamp)

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'text-primary hover:underline cursor-pointer font-mono text-sm',
        className
      )}
      aria-label={`Jump to ${formatted}`}
    >
      {children ?? formatted}
    </button>
  )
}
