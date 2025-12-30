import { memo } from 'react'
import { Mic, FileText, Play, X, Download, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'

interface Meeting {
  id: string
  subject: string
  start_time: string
}

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

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectionChange?.(recording.id, e.shiftKey)
  }

  return (
    <div
      className={`flex items-center justify-between p-3 hover:bg-muted/50 ${isSelected ? 'bg-primary/5' : ''}`}
      role="option"
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
          <p className="font-medium text-sm truncate">{recording.filename}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(recording.dateRecorded.toISOString())}
            {recording.duration ? ` • ${formatDuration(recording.duration)}` : ''}
            {meeting ? ` • ${meeting.subject}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Transcription status badge */}
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            recording.transcriptionStatus === 'complete'
              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
              : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'
              ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
              : recording.transcriptionStatus === 'error'
              ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
              : 'bg-secondary'
          }`}
        >
          {recording.transcriptionStatus === 'none' ? '—' : recording.transcriptionStatus}
        </span>

        {/* Action buttons */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onAskAssistant}
          title="Ask Assistant about this capture"
        >
          <Mic className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onGenerateOutput}
          title="Generate artifact from this capture"
        >
          <FileText className="h-3 w-3" />
        </Button>

        {/* Download button for device-only recordings */}
        {isDeviceOnly(recording) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onDownload}
            disabled={!deviceConnected || isDownloading}
          >
            {isDownloading ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
          </Button>
        )}

        {/* Play/Stop button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={isPlaying ? onStop : onPlay}
          disabled={!canPlay}
        >
          {isPlaying ? <X className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>

        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${
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
              ? 'Delete from device'
              : recording.location === 'local-only'
              ? 'Delete local file'
              : 'Delete local copy'
          }
        >
          {isDeleting ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
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
