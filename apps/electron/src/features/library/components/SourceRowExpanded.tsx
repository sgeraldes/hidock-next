import { memo } from 'react'
import { Mic, FileText, Calendar, Play, X, Download, RefreshCw, Trash2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatDuration, formatBytes } from '@/lib/utils'
import { Transcript, Meeting } from '@/types'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'

interface SourceRowExpandedProps {
  recording: UnifiedRecording
  transcript?: Transcript
  meeting?: Meeting
  isPlaying: boolean
  isDownloading: boolean
  isDeleting: boolean
  deviceConnected: boolean
  onPlay: () => void
  onStop: () => void
  onDownload: () => void
  onDelete: () => void
  onTranscribe: () => void
  onAskAssistant: () => void
  onGenerateOutput: () => void
  onNavigateToMeeting: (meetingId: string) => void
}

export const SourceRowExpanded = memo(function SourceRowExpanded({
  recording,
  transcript,
  meeting,
  isPlaying,
  isDownloading,
  isDeleting,
  deviceConnected,
  onPlay,
  onStop,
  onDownload,
  onDelete,
  onTranscribe,
  onAskAssistant,
  onGenerateOutput,
  onNavigateToMeeting
}: SourceRowExpandedProps) {
  const canPlay = hasLocalPath(recording)
  const showTranscribeButton = hasLocalPath(recording) &&
    (recording.transcriptionStatus === 'none' || recording.transcriptionStatus === 'error')

  return (
    <div
      id={`expanded-${recording.id}`}
      role="region"
      aria-label={`Details for ${recording.filename}`}
      className="bg-muted/30 mx-3 mb-3 p-4 rounded-lg border border-border"
    >
      <div className="space-y-4">
        {/* Metadata Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Date Recorded</p>
            <p>{formatDateTime(recording.dateRecorded.toISOString())}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Duration</p>
            <p>{recording.duration ? formatDuration(recording.duration) : 'Unknown'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Size</p>
            <p>{recording.size ? formatBytes(recording.size) : 'Unknown'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Quality</p>
            <p className="capitalize">{recording.quality || 'Standard'}</p>
          </div>
          {recording.category && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Category</p>
              <p className="capitalize">{recording.category}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Location</p>
            <p className="capitalize">{recording.location.replace('-', ' ')}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Transcription</p>
            <p className="capitalize">{recording.transcriptionStatus}</p>
          </div>
          {recording.title && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Title</p>
              <p>{recording.title}</p>
            </div>
          )}
        </div>

        {/* Linked Meeting */}
        {meeting && (
          <div
            className="flex items-center gap-2 p-3 bg-background border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => onNavigateToMeeting(meeting.id)}
          >
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{meeting.subject}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(meeting.start_time)}</p>
            </div>
          </div>
        )}

        {/* Transcript Summary */}
        {transcript?.summary && (
          <div className="p-3 bg-background border rounded-lg">
            <p className="text-xs font-medium text-muted-foreground mb-2">Summary</p>
            <p className="text-sm leading-relaxed">{transcript.summary}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {/* Play/Stop */}
          <Button
            variant="default"
            size="sm"
            onClick={isPlaying ? onStop : onPlay}
            disabled={!canPlay}
          >
            {isPlaying ? (
              <>
                <X className="h-3 w-3 mr-1" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3 w-3 mr-1" />
                Play
              </>
            )}
          </Button>

          {/* Download (device-only) */}
          {isDeviceOnly(recording) && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              disabled={!deviceConnected || isDownloading}
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="h-3 w-3 mr-1" />
                  Download
                </>
              )}
            </Button>
          )}

          {/* Transcribe */}
          {showTranscribeButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={onTranscribe}
            >
              <Sparkles className="h-3 w-3 mr-1" />
              Transcribe
            </Button>
          )}

          {/* Ask Assistant */}
          <Button
            variant="outline"
            size="sm"
            onClick={onAskAssistant}
          >
            <Mic className="h-3 w-3 mr-1" />
            Ask Assistant
          </Button>

          {/* Generate Output */}
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerateOutput}
          >
            <FileText className="h-3 w-3 mr-1" />
            Generate Output
          </Button>

          {/* Delete */}
          <Button
            variant="outline"
            size="sm"
            className={
              recording.location === 'device-only'
                ? 'text-destructive hover:text-destructive'
                : recording.location === 'local-only'
                ? 'text-orange-500 hover:text-orange-600'
                : 'text-muted-foreground hover:text-orange-500'
            }
            onClick={onDelete}
            disabled={(recording.location === 'device-only' && !deviceConnected) || isDeleting}
          >
            {isDeleting ? (
              <>
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-3 w-3 mr-1" />
                Delete
              </>
            )}
          </Button>
        </div>

        {/* Device-only notice */}
        {isDeviceOnly(recording) && (
          <p className="text-xs text-muted-foreground italic">
            Download this capture to play it and generate a transcript.
          </p>
        )}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  return (
    prevProps.recording.id === nextProps.recording.id &&
    prevProps.recording.transcriptionStatus === nextProps.recording.transcriptionStatus &&
    prevProps.recording.quality === nextProps.recording.quality &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.isDownloading === nextProps.isDownloading &&
    prevProps.isDeleting === nextProps.isDeleting &&
    prevProps.deviceConnected === nextProps.deviceConnected &&
    prevProps.transcript?.id === nextProps.transcript?.id &&
    prevProps.meeting?.id === nextProps.meeting?.id
  )
})
