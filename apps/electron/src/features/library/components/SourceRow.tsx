import { memo } from 'react'
import { Play, X, AlertCircle, Download, Trash2, Wand2, Sparkles, FileText, RefreshCw, AudioLines, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { formatDate, formatDuration } from '@/lib/utils'
import { Meeting, Transcript } from '@/types'
import { UnifiedRecording, hasLocalPath } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { getDisplayTitle } from '@/features/library/utils/getDisplayTitle'
import { highlightText } from '@/features/library/utils/highlightText'

interface SourceRowProps {
  recording: UnifiedRecording
  meeting?: Meeting
  transcript?: Transcript
  isPlaying: boolean
  isSelected?: boolean
  isActiveSource?: boolean
  searchQuery?: string
  onSelectionChange?: (id: string, shiftKey: boolean) => void
  onClick?: () => void
  onPlay: () => void
  onStop: () => void
  // Action handlers
  onDownload?: () => void
  onDelete?: () => void
  onTranscribe?: () => void
  onReprocessVibeVoice?: () => void
  onAskAssistant?: () => void
  onGenerateOutput?: () => void
  // Download state for device-only recordings
  isDownloading?: boolean
  downloadProgress?: number
  deviceConnected?: boolean
}

export const SourceRow = memo(function SourceRow({
  recording,
  meeting,
  transcript,
  isPlaying,
  isSelected = false,
  isActiveSource = false,
  searchQuery = '',
  onSelectionChange,
  onClick,
  onPlay,
  onStop,
  onDownload,
  onDelete,
  onTranscribe,
  onReprocessVibeVoice,
  onAskAssistant,
  onGenerateOutput,
  isDownloading = false,
  downloadProgress,
  deviceConnected = false
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
        '@container flex items-center justify-between py-2 px-3 hover:bg-muted/50 cursor-pointer transition-colors',
        isSelected ? 'bg-primary/10 border-l-2 border-l-primary/50' : 'border-l-2 border-l-transparent',
        isActiveSource ? 'bg-primary/15 border-l-primary' : ''
      ].filter(Boolean).join(' ')}
      role="option"
      onClick={handleRowClick}
      aria-selected={isSelected}
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
          <p className="font-medium text-sm line-clamp-2 text-foreground leading-tight" title={primaryText}>
            {searchQuery ? highlightText(primaryText, searchQuery) : primaryText}
          </p>
          <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
            {searchQuery ? highlightText(secondaryText, searchQuery) : secondaryText}
          </p>
        </div>
      </div>

      {/* Action area — error + primary Play; everything else in an overflow menu */}
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {/* Error indicator */}
        {error && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" aria-label="Processing error" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{error.message}</p>
                {error.details && <p className="text-xs text-muted-foreground mt-1">{error.details}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Download progress (device-only, in flight) */}
        {recording.location === 'device-only' && isDownloading && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground px-2" aria-live="polite">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span>{downloadProgress ?? 0}%</span>
          </div>
        )}

        {/* Primary action: Play / Stop (always visible) */}
        {isPlaying ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onStop(); }}
            aria-label="Stop playback"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            disabled={!canPlay || error?.type === 'audio_not_found'}
            aria-label={
              error?.type === 'audio_not_found' ? 'File missing'
                : canPlay ? 'Play capture'
                  : 'Download to play'
            }
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}

        {/* Secondary actions: overflow menu (labeled, keeps the row uncluttered) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => e.stopPropagation()}
              aria-label="More actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {onAskAssistant && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onAskAssistant(); }}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Ask Assistant
              </DropdownMenuItem>
            )}
            {onGenerateOutput && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onGenerateOutput(); }}>
                <FileText className="h-4 w-4" aria-hidden="true" />
                Generate output
              </DropdownMenuItem>
            )}
            {hasLocalPath(recording) && recording.transcriptionStatus !== 'complete' && onTranscribe && (
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onTranscribe(); }}
                disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
              >
                {recording.transcriptionStatus === 'processing'
                  ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Wand2 className="h-4 w-4" aria-hidden="true" />}
                {recording.transcriptionStatus === 'pending' ? 'Transcription queued'
                  : recording.transcriptionStatus === 'processing' ? 'Transcribing…'
                    : 'Transcribe'}
              </DropdownMenuItem>
            )}
            {hasLocalPath(recording) && onReprocessVibeVoice && (
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onReprocessVibeVoice(); }}
                disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
              >
                <AudioLines className="h-4 w-4" aria-hidden="true" />
                Re-transcribe (VibeVoice)
              </DropdownMenuItem>
            )}
            {recording.location === 'device-only' && onDownload && !isDownloading && (
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onDownload(); }}
                disabled={!deviceConnected}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {deviceConnected ? 'Download to computer' : 'Device not connected'}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {recording.location === 'device-only' ? 'Delete from device'
                    : recording.location === 'local-only' ? 'Delete from computer'
                      : 'Delete everywhere'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
    prevProps.searchQuery === nextProps.searchQuery &&
    // Include callback props to detect when they change
    prevProps.onSelectionChange === nextProps.onSelectionChange &&
    prevProps.onClick === nextProps.onClick
  )
})
