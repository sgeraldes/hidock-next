import { memo } from 'react'
import { Calendar } from 'lucide-react'
import { formatDateTime, formatDuration, formatBytes } from '@/lib/utils'
import { Transcript, Meeting } from '@/types'
import { UnifiedRecording, isDeviceOnly } from '@/types/unified-recording'

interface SourceRowExpandedProps {
  recording: UnifiedRecording
  transcript?: Transcript
  meeting?: Meeting
  onNavigateToMeeting: (meetingId: string) => void
}

export const SourceRowExpanded = memo(function SourceRowExpanded({
  recording,
  transcript,
  meeting,
  onNavigateToMeeting
}: SourceRowExpandedProps) {
  return (
    <div
      id={`expanded-${recording.id}`}
      role="region"
      aria-label={`Details for ${recording.filename}`}
      className="mx-3 mb-3 p-4 rounded-lg border border-border bg-muted shadow-md space-y-3"
    >
      {/* Metadata Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Date Recorded</p>
          <p>{(() => {
            const date = new Date(recording.dateRecorded)
            return !isNaN(date.getTime()) ? formatDateTime(date.toISOString()) : 'Unknown'
          })()}</p>
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

      {/* Device-only notice */}
      {isDeviceOnly(recording) && (
        <p className="text-xs text-muted-foreground italic">
          Download this capture to play it and generate a transcript.
        </p>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  // C-005: Include all displayed fields in memo comparison
  return (
    prevProps.recording.id === nextProps.recording.id &&
    prevProps.recording.transcriptionStatus === nextProps.recording.transcriptionStatus &&
    prevProps.recording.quality === nextProps.recording.quality &&
    prevProps.recording.category === nextProps.recording.category &&
    prevProps.recording.title === nextProps.recording.title &&
    prevProps.recording.location === nextProps.recording.location &&
    prevProps.recording.duration === nextProps.recording.duration &&
    prevProps.recording.size === nextProps.recording.size &&
    prevProps.transcript?.id === nextProps.transcript?.id &&
    prevProps.transcript?.summary === nextProps.transcript?.summary &&
    prevProps.meeting?.id === nextProps.meeting?.id
  )
})
