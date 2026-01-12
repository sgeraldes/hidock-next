import { memo } from 'react'
import { Mic, FileText, Play, X, Download, RefreshCw, Trash2, AlertCircle, Check, Clock, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { Meeting, Transcript } from '@/types'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'
import { SourceRowExpanded } from './SourceRowExpanded'
import { LiveRegion, useAnnouncement } from './LiveRegion'
import { useLibraryStore } from '@/store/useLibraryStore'

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
  // downloadProgress could be used for a progress indicator in the future
  void _downloadProgress
  const canPlay = hasLocalPath(recording)
  const error = useLibraryStore((state) => state.recordingErrors.get(recording.id))
  const { message: announcement, announce } = useAnnouncement()

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

  return (
    <div>
      <LiveRegion message={announcement} />
      <div
        className={`@container flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
        role="option"
        onClick={handleRowClick}
        aria-selected={isPlaying || isSelected}
        tabIndex={0}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {onToggleExpand && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
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
          <div className="flex-1 shrink min-w-0" style={{ flexBasis: '150px' }}>
            <p className="font-medium text-sm truncate text-foreground">
              {recording.title || recording.filename}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {formatDateTime(recording.dateRecorded.toISOString())}
              {recording.duration ? ` • ${formatDuration(recording.duration)}` : ''}
              {meeting ? ` • ${meeting.subject}` : ''}
            </p>
          </div>
        </div>
        <div className="hidden @[200px]:flex items-center gap-[3px] @[400px]:gap-1.5">
          {/* Error badge */}
          {error && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300">
                    <AlertCircle className="h-3 w-3" />
                    <span>Error</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{error.message}</p>
                  {error.details && <p className="text-xs text-muted-foreground mt-1">{error.details}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Transcription status badge - icon-only at narrow, full at wide */}
          <span
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
              recording.transcriptionStatus === 'complete'
                ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'
                ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                : recording.transcriptionStatus === 'error'
                ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {/* Icon always visible */}
            {recording.transcriptionStatus === 'complete' && <Check className="h-3 w-3" />}
            {(recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing') && (
              <Clock className="h-3 w-3" />
            )}
            {recording.transcriptionStatus === 'error' && <AlertCircle className="h-3 w-3" />}
            {/* Text hidden at narrow widths */}
            <span className="hidden @[300px]:inline">
              {recording.transcriptionStatus === 'none' ? '—' : recording.transcriptionStatus}
            </span>
          </span>

          {/* Action buttons */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={onAskAssistant}
            title="Ask Assistant about this capture"
          >
            <Mic className="h-3 w-3" />
            <span className="hidden @[400px]:inline text-xs">Ask</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={onGenerateOutput}
            title="Generate artifact from this capture"
          >
            <FileText className="h-3 w-3" />
            <span className="hidden @[400px]:inline text-xs">Generate</span>
          </Button>

          {/* Download button for device-only recordings */}
          {isDeviceOnly(recording) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5"
              onClick={onDownload}
              disabled={!deviceConnected || isDownloading}
              title="Download from device"
            >
              {isDownloading ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              <span className="hidden @[400px]:inline text-xs">{isDownloading ? 'Downloading' : 'Download'}</span>
            </Button>
          )}

          {/* Play/Stop button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={isPlaying ? onStop : onPlay}
            disabled={!canPlay}
            title={isPlaying ? 'Stop playback' : 'Play recording'}
          >
            {isPlaying ? <X className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            <span className="hidden @[400px]:inline text-xs">{isPlaying ? 'Stop' : 'Play'}</span>
          </Button>

          {/* Delete button */}
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 gap-1.5 ${
              recording.location === 'device-only'
                ? 'text-destructive hover:text-destructive'
                : recording.location === 'local-only'
                ? 'text-orange-500 hover:text-orange-600'
                : 'text-muted-foreground hover:text-orange-500'
            }`}
            onClick={onDelete}
            disabled={
              (recording.location === 'device-only' && !deviceConnected) || isDeleting
            }
            title={
              recording.location === 'device-only'
                ? 'Delete from device (cannot be undone)'
                : recording.location === 'local-only'
                ? 'Delete local file and transcript'
                : 'Delete local copy only (keeps device copy)'
            }
          >
            {isDeleting ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            <span className="hidden @[400px]:inline text-xs">{isDeleting ? 'Deleting' : 'Delete'}</span>
          </Button>
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
                isPlaying={isPlaying}
                isDownloading={isDownloading}
                isDeleting={isDeleting}
                deviceConnected={deviceConnected}
                onPlay={onPlay}
                onStop={onStop}
                onDownload={onDownload}
                onDelete={onDelete}
                onTranscribe={onTranscribe || (() => {})}
                onAskAssistant={onAskAssistant}
                onGenerateOutput={onGenerateOutput}
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
    prevProps.recording.transcriptionStatus === nextProps.recording.transcriptionStatus &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.isDownloading === nextProps.isDownloading &&
    prevProps.downloadProgress === nextProps.downloadProgress &&
    prevProps.isDeleting === nextProps.isDeleting &&
    prevProps.deviceConnected === nextProps.deviceConnected &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.transcript?.id === nextProps.transcript?.id &&
    prevProps.meeting?.id === nextProps.meeting?.id &&
    // Include callback props to detect when they change
    prevProps.onToggleExpand === nextProps.onToggleExpand &&
    prevProps.onSelectionChange === nextProps.onSelectionChange &&
    prevProps.onClick === nextProps.onClick
  )
})
