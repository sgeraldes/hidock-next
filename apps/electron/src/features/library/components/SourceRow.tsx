import { memo } from 'react'
import {
  Mic, FileText, Play, X, Download, RefreshCw, Trash2,
  AlertCircle, ChevronDown, ChevronRight, MoreHorizontal, Sparkles
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { formatDate, formatDuration } from '@/lib/utils'
import { Meeting, Transcript } from '@/types'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { SourceRowExpanded } from './SourceRowExpanded'
import { LiveRegion, useAnnouncement } from './LiveRegion'
import { useLibraryStore } from '@/store/useLibraryStore'
import { getDisplayTitle } from '@/features/library/utils/getDisplayTitle'

interface SourceRowProps {
  recording: UnifiedRecording
  meeting?: Meeting
  transcript?: Transcript
  isPlaying: boolean
  isDownloading: boolean
  downloadProgress?: number
  isDeleting: boolean
  deviceConnected: boolean
  isSelected?: boolean
  isExpanded?: boolean
  isActiveSource?: boolean
  onSelectionChange?: (id: string, shiftKey: boolean) => void
  onClick?: () => void
  onToggleExpand?: () => void
  onPlay: () => void
  onStop: () => void
  onDownload: () => void
  onDelete: () => void
  onTranscribe?: () => void
  onAskAssistant: () => void
  onGenerateOutput: () => void
  onNavigateToMeeting?: (meetingId: string) => void
}

export const SourceRow = memo(function SourceRow({
  recording,
  meeting,
  transcript,
  isPlaying,
  isDownloading,
  downloadProgress: _downloadProgress,
  isDeleting,
  deviceConnected,
  isSelected = false,
  isExpanded = false,
  isActiveSource = false,
  onSelectionChange,
  onClick,
  onToggleExpand,
  onPlay,
  onStop,
  onDownload,
  onDelete,
  onTranscribe,
  onAskAssistant,
  onGenerateOutput,
  onNavigateToMeeting
}: SourceRowProps) {
  // TODO: downloadProgress is accepted in the interface for future use (e.g., inline progress bar
  // in the row). Currently discarded because the compact row layout doesn't have space for it.
  // The progress is shown in the OperationsPanel sidebar instead.
  void _downloadProgress
  const canPlay = hasLocalPath(recording)
  const error = useLibraryStore((state) => state.recordingErrors.get(recording.id))
  const { message: announcement, announce } = useAnnouncement()

  // Smart title
  const { primaryText, source: titleSource } = getDisplayTitle(recording, meeting, transcript)
  const showFilenameInSecondary = titleSource !== 'filename'

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectionChange?.(recording.id, e.shiftKey)
  }

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger onClick if clicking on buttons, checkbox, or dropdown
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('[role="checkbox"]') || target.closest('[role="menu"]')) {
      return
    }
    onClick?.()
  }

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation()

    // Announce expansion state change to screen readers
    if (!isExpanded) {
      const date = recording.dateRecorded
        ? new Date(recording.dateRecorded).toLocaleDateString()
        : 'Unknown date'
      const duration = recording.duration ? formatDuration(recording.duration) : 'Unknown duration'
      announce(`Recording details expanded. ${date}, ${duration}`)
    } else {
      announce('Recording details collapsed')
    }

    onToggleExpand?.()
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

  // Can transcribe?
  const canTranscribe = hasLocalPath(recording) &&
    (recording.transcriptionStatus === 'none' || recording.transcriptionStatus === 'error')

  return (
    <div>
      <LiveRegion message={announcement} />
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
          {onToggleExpand && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={handleExpandClick}
              aria-expanded={isExpanded}
              aria-controls={`expanded-${recording.id}`}
              aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </Button>
          )}
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

        {/* Action area — fixed width, only play + dropdown */}
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

          {/* Play/Stop button — always visible */}
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

          {/* Dropdown menu — all other actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title="More actions"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onAskAssistant}>
                <Mic className="h-4 w-4 mr-2" />
                Ask Assistant
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onGenerateOutput}>
                <FileText className="h-4 w-4 mr-2" />
                Generate Output
              </DropdownMenuItem>

              {canTranscribe && (
                <DropdownMenuItem onClick={onTranscribe}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Transcribe
                </DropdownMenuItem>
              )}

              {/* Download — device-only recordings */}
              {isDeviceOnly(recording) && (
                <DropdownMenuItem
                  onClick={onDownload}
                  disabled={!deviceConnected || isDownloading}
                >
                  {isDownloading ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {isDownloading ? 'Downloading...' : 'Download'}
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {/* Delete */}
              <DropdownMenuItem
                onClick={onDelete}
                disabled={
                  (recording.location === 'device-only' && !deviceConnected) || isDeleting
                }
                className={
                  recording.location === 'device-only'
                    ? 'text-destructive focus:text-destructive'
                    : recording.location === 'local-only'
                    ? 'text-orange-500 focus:text-orange-500'
                    : 'text-muted-foreground focus:text-orange-500'
                }
              >
                {isDeleting ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded Content */}
      {onToggleExpand && (
        <div className={`source-row__expand-container ${isExpanded ? 'expanded' : ''}`}>
          <div className="source-row__expand-content">
            {isExpanded && (
              <SourceRowExpanded
                recording={recording}
                transcript={transcript}
                meeting={meeting}
                onNavigateToMeeting={onNavigateToMeeting || (() => {})}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison for performance
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
    prevProps.isDownloading === nextProps.isDownloading &&
    prevProps.downloadProgress === nextProps.downloadProgress &&
    prevProps.isDeleting === nextProps.isDeleting &&
    prevProps.deviceConnected === nextProps.deviceConnected &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isActiveSource === nextProps.isActiveSource &&
    prevProps.transcript?.id === nextProps.transcript?.id &&
    prevProps.transcript?.title_suggestion === nextProps.transcript?.title_suggestion &&
    prevProps.meeting?.id === nextProps.meeting?.id &&
    prevProps.meeting?.subject === nextProps.meeting?.subject &&
    // Include callback props to detect when they change
    prevProps.onToggleExpand === nextProps.onToggleExpand &&
    prevProps.onSelectionChange === nextProps.onSelectionChange &&
    prevProps.onClick === nextProps.onClick
  )
})
