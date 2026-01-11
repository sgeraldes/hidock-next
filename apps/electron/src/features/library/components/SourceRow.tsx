import { memo } from 'react'
import { Mic, FileText, Play, X, Download, RefreshCw, Trash2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { Meeting } from '@/types'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'
import { useLibraryStore } from '@/store/useLibraryStore'

interface SourceRowProps {
  recording: UnifiedRecording
  meeting?: Meeting
  isPlaying: boolean
  isDownloading: boolean
  downloadProgress?: number
  isDeleting: boolean
  deviceConnected: boolean
  isSelected?: boolean
  onSelectionChange?: (id: string, shiftKey: boolean) => void
  onClick?: () => void
  onPlay: () => void
  onStop: () => void
  onDownload: () => void
  onDelete: () => void
  onAskAssistant: () => void
  onGenerateOutput: () => void
}

export const SourceRow = memo(function SourceRow({
  recording,
  meeting,
  isPlaying,
  isDownloading,
  downloadProgress: _downloadProgress,
  isDeleting,
  deviceConnected,
  isSelected = false,
  onSelectionChange,
  onClick,
  onPlay,
  onStop,
  onDownload,
  onDelete,
  onAskAssistant,
  onGenerateOutput
}: SourceRowProps) {
  // downloadProgress could be used for a progress indicator in the future
  void _downloadProgress
  const canPlay = hasLocalPath(recording)
  const error = useLibraryStore((state) => state.recordingErrors.get(recording.id))

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

  return (
    <div
      className={`flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
      role="option"
      onClick={handleRowClick}
      aria-selected={isPlaying || isSelected}
      tabIndex={0}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {onSelectionChange && (
          <Checkbox
            checked={isSelected}
            onClick={handleCheckboxClick}
            aria-label={`Select ${recording.filename}`}
            className="shrink-0"
          />
        )}
        <StatusIcon recording={recording} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate text-foreground">{recording.filename}</p>
          <p className="text-xs text-muted-foreground truncate">
            {formatDateTime(recording.dateRecorded.toISOString())}
            {recording.duration ? ` • ${formatDuration(recording.duration)}` : ''}
            {meeting ? ` • ${meeting.subject}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
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

        {/* Transcription status badge */}
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            recording.transcriptionStatus === 'complete'
              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
              : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'
              ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
              : recording.transcriptionStatus === 'error'
              ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
              : 'bg-secondary text-secondary-foreground'
          }`}
        >
          {recording.transcriptionStatus === 'none' ? '—' : recording.transcriptionStatus}
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
          <span className="hidden sm:inline text-xs">Ask</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5"
          onClick={onGenerateOutput}
          title="Generate artifact from this capture"
        >
          <FileText className="h-3 w-3" />
          <span className="hidden sm:inline text-xs">Generate</span>
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
            <span className="hidden sm:inline text-xs">{isDownloading ? 'Downloading' : 'Download'}</span>
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
          <span className="hidden sm:inline text-xs">{isPlaying ? 'Stop' : 'Play'}</span>
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
          <span className="hidden sm:inline text-xs">{isDeleting ? 'Deleting' : 'Delete'}</span>
        </Button>
      </div>
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
    prevProps.meeting?.subject === nextProps.meeting?.subject
  )
})
