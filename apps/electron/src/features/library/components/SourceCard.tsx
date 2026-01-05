import { memo } from 'react'
import {
  Mic,
  FileText,
  Calendar,
  Play,
  X,
  Download,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AudioPlayer } from '@/components/AudioPlayer'
import { formatDateTime, formatDuration, formatBytes } from '@/lib/utils'
import { parseJsonArray, Transcript, Meeting } from '@/types'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'
import { useLibraryStore } from '@/store/useLibraryStore'

interface SourceCardProps {
  recording: UnifiedRecording
  transcript?: Transcript
  meeting?: Meeting
  isPlaying: boolean
  isTranscriptExpanded: boolean
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
  onToggleTranscript: () => void
  onNavigateToMeeting: (meetingId: string) => void
}

export const SourceCard = memo(function SourceCard({
  recording,
  transcript,
  meeting,
  isPlaying,
  isTranscriptExpanded,
  isDownloading,
  downloadProgress,
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
  onGenerateOutput,
  onToggleTranscript,
  onNavigateToMeeting
}: SourceCardProps) {
  const canPlay = hasLocalPath(recording)
  const error = useLibraryStore((state) => state.recordingErrors.get(recording.id))

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectionChange?.(recording.id, e.shiftKey)
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger onClick if clicking on buttons, checkbox, or interactive elements
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('[role="checkbox"]') || target.closest('a')) {
      return
    }
    onClick?.()
  }

  return (
    <Card className={`${isSelected ? 'ring-2 ring-primary' : ''} cursor-pointer`} onClick={handleCardClick}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {onSelectionChange && (
              <Checkbox
                checked={isSelected}
                onClick={handleCheckboxClick}
                aria-label={`Select ${recording.filename}`}
                className="shrink-0"
              />
            )}
            <StatusIcon recording={recording} />
            <div>
              <CardTitle className="text-base">{recording.title || recording.filename}</CardTitle>
              <CardDescription>
                {formatDateTime(recording.dateRecorded.toISOString())}
                {recording.size && ` • ${formatBytes(recording.size)}`}
                {recording.duration && ` • ${formatDuration(recording.duration)}`}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Quality badge */}
            {recording.quality && (
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  recording.quality === 'valuable'
                    ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                    : recording.quality === 'archived'
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                    : 'bg-secondary'
                }`}
              >
                {recording.quality}
              </span>
            )}

            <Button variant="ghost" size="icon" onClick={onAskAssistant} title="Ask Assistant about this capture">
              <Mic className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" onClick={onGenerateOutput} title="Generate artifact from this capture">
              <FileText className="h-4 w-4" />
            </Button>

            {/* Transcription status badge */}
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                recording.transcriptionStatus === 'complete'
                  ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                  : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'
                  ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                  : recording.transcriptionStatus === 'error'
                  ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                  : 'bg-secondary'
              }`}
            >
              {recording.transcriptionStatus === 'none' ? 'not transcribed' : recording.transcriptionStatus}
            </span>

            {/* Download button for device-only recordings */}
            {isDeviceOnly(recording) &&
              (isDownloading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  {downloadProgress ?? 0}%
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onDownload}
                  disabled={!deviceConnected}
                  title={deviceConnected ? 'Download to computer' : 'Device not connected'}
                >
                  <Download className="h-4 w-4" />
                </Button>
              ))}

            {/* Play button */}
            {isPlaying ? (
              <Button variant="ghost" size="icon" onClick={onStop}>
                <X className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={onPlay}
                disabled={!canPlay || error?.type === 'audio_not_found'}
                title={
                  error?.type === 'audio_not_found'
                    ? 'File missing'
                    : canPlay
                      ? 'Play capture'
                      : 'Download to play'
                }
              >
                <Play className="h-4 w-4" />
              </Button>
            )}

            {/* Delete button */}
            <Button
              variant="ghost"
              size="icon"
              className={
                recording.location === 'device-only'
                  ? 'text-destructive hover:text-destructive'
                  : recording.location === 'local-only'
                  ? 'text-orange-500 hover:text-orange-600'
                  : 'text-muted-foreground hover:text-orange-500'
              }
              onClick={onDelete}
              disabled={(recording.location === 'device-only' && !deviceConnected) || isDeleting}
              title={
                recording.location === 'device-only'
                  ? 'Delete from device'
                  : recording.location === 'local-only'
                  ? 'Delete local file'
                  : 'Delete local copy'
              }
            >
              {isDeleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Audio Player */}
        {isPlaying && hasLocalPath(recording) && (
          <AudioPlayer filename={recording.filename} onClose={onStop} />
        )}

        {/* Linked Meeting */}
        {meeting && (
          <div
            className="flex items-center gap-2 p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80"
            onClick={() => onNavigateToMeeting(meeting.id)}
          >
            <Calendar className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">{meeting.subject}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(meeting.start_time)}</p>
            </div>
          </div>
        )}

        {/* Transcript */}
        {transcript && (
          <div className="border rounded-lg">
            <button
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50"
              onClick={onToggleTranscript}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="font-medium text-sm">Transcript</span>
                {transcript.word_count && (
                  <span className="text-xs text-muted-foreground">({transcript.word_count} words)</span>
                )}
              </div>
              {isTranscriptExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {isTranscriptExpanded && (
              <div className="p-3 pt-0 space-y-3">
                {/* Summary */}
                {transcript.summary && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                    <p className="text-sm">{transcript.summary}</p>
                  </div>
                )}

                {/* Action Items */}
                {transcript.action_items && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Action Items</p>
                    <ul className="list-disc list-inside text-sm space-y-1">
                      {parseJsonArray<string>(transcript.action_items).map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Points */}
                {transcript.key_points && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Key Points</p>
                    <ul className="list-disc list-inside text-sm space-y-1">
                      {parseJsonArray<string>(transcript.key_points).map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Topics */}
                {transcript.topics && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Topics</p>
                    <div className="flex flex-wrap gap-1">
                      {parseJsonArray<string>(transcript.topics).map((topic, i) => (
                        <span key={i} className="px-2 py-0.5 bg-secondary text-xs rounded-full">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full Text */}
                <details className="mt-2">
                  <summary className="text-sm text-primary cursor-pointer hover:underline">View full transcript</summary>
                  <p className="mt-2 text-sm whitespace-pre-wrap bg-muted p-3 rounded-lg max-h-64 overflow-auto">
                    {transcript.full_text}
                  </p>
                </details>

                {/* Metadata */}
                <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t">
                  {transcript.language && <span>Language: {transcript.language}</span>}
                  {transcript.transcription_provider && <span>Provider: {transcript.transcription_provider}</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Device-only notice */}
        {isDeviceOnly(recording) && (
          <p className="text-xs text-muted-foreground italic">
            Download this capture to play it and generate a transcript.
          </p>
        )}
      </CardContent>
    </Card>
  )
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  return (
    prevProps.recording.id === nextProps.recording.id &&
    prevProps.recording.transcriptionStatus === nextProps.recording.transcriptionStatus &&
    prevProps.recording.quality === nextProps.recording.quality &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.isTranscriptExpanded === nextProps.isTranscriptExpanded &&
    prevProps.isDownloading === nextProps.isDownloading &&
    prevProps.downloadProgress === nextProps.downloadProgress &&
    prevProps.isDeleting === nextProps.isDeleting &&
    prevProps.deviceConnected === nextProps.deviceConnected &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.transcript?.id === nextProps.transcript?.id &&
    prevProps.meeting?.id === nextProps.meeting?.id
  )
})
