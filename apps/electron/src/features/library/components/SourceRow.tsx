import { memo } from 'react'
import { Play, X, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDate, formatDuration } from '@/lib/utils'
import { Meeting, Transcript } from '@/types'
import { UnifiedRecording, hasLocalPath } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { getDisplayTitle } from '@/features/library/utils/getDisplayTitle'

interface SourceRowProps {
  recording: UnifiedRecording
  meeting?: Meeting
  transcript?: Transcript
  isPlaying: boolean
  isSelected?: boolean
  isActiveSource?: boolean
  onSelectionChange?: (id: string, shiftKey: boolean) => void
  onClick?: () => void
  onPlay: () => void
  onStop: () => void
}

export const SourceRow = memo(function SourceRow({
  recording,
  meeting,
  transcript,
  isPlaying,
  isSelected = false,
  isActiveSource = false,
  onSelectionChange,
  onClick,
  onPlay,
  onStop
}: SourceRowProps) {
  const canPlay = hasLocalPath(recording)
  const error = useLibraryStore((state) => state.recordingErrors.get(recording.id))

  // Smart title
  const { primaryText, source: titleSource } = getDisplayTitle(recording, meeting, transcript)
  const showFilenameInSecondary = titleSource !== 'filename'

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectionChange?.(recording.id, e.shiftKey)
  }

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger onClick if clicking on buttons or checkbox
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('[role="checkbox"]')) {
      return
    }
    onClick?.()
  }

  // Build secondary line: date + duration + filename (when title isn't filename)
  const secondaryParts: string[] = []
  secondaryParts.push(formatDate(recording.dateRecorded))
  if (recording.duration) {
    secondaryParts.push(formatDuration(recording.duration))
  }
  if (showFilenameInSecondary) {
    secondaryParts.push(recording.filename)
  }
  const secondaryText = secondaryParts.join(' \u00B7 ')

  return (
    <div
      className={[
        '@container flex items-center justify-between py-2 px-3 hover:bg-muted/50 cursor-pointer',
        isSelected ? 'bg-primary/5' : '',
        isActiveSource ? 'bg-primary/10 border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'
      ].join(' ')}
      role="option"
      onClick={handleRowClick}
      aria-selected={isPlaying || isSelected}
      tabIndex={0}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {onSelectionChange && (
          <Checkbox
            checked={isSelected}
            onClick={handleCheckboxClick}
            aria-label={`Select ${recording.filename}`}
            className="shrink-0"
          />
        )}
        <StatusIcon recording={recording} />
        <TranscriptionStatusBadge status={recording.transcriptionStatus} compact />

        {/* Content area — flex-1 to fill remaining space */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate text-foreground leading-tight">
            {primaryText}
          </p>
          <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
            {secondaryText}
          </p>
        </div>
      </div>

      {/* Action area — only play button and error indicator */}
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {/* Error indicator */}
        {error && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{error.message}</p>
                {error.details && <p className="text-xs text-muted-foreground mt-1">{error.details}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Play/Stop button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={isPlaying ? onStop : onPlay}
          disabled={!canPlay}
          title={isPlaying ? 'Stop playback' : 'Play recording'}
        >
          {isPlaying ? <X className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  // LB-16 fix: Include recording.location in equality check to detect download state changes
  return (
    prevProps.recording.id === nextProps.recording.id &&
    prevProps.recording.location === nextProps.recording.location &&
    prevProps.recording.transcriptionStatus === nextProps.recording.transcriptionStatus &&
    prevProps.recording.title === nextProps.recording.title &&
    prevProps.recording.meetingSubject === nextProps.recording.meetingSubject &&
    prevProps.recording.category === nextProps.recording.category &&
    prevProps.recording.quality === nextProps.recording.quality &&
    prevProps.recording.duration === nextProps.recording.duration &&
    prevProps.recording.size === nextProps.recording.size &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isActiveSource === nextProps.isActiveSource &&
    prevProps.transcript?.id === nextProps.transcript?.id &&
    prevProps.transcript?.title_suggestion === nextProps.transcript?.title_suggestion &&
    prevProps.meeting?.id === nextProps.meeting?.id &&
    prevProps.meeting?.subject === nextProps.meeting?.subject &&
    // Include callback props to detect when they change
    prevProps.onSelectionChange === nextProps.onSelectionChange &&
    prevProps.onClick === nextProps.onClick
  )
})
