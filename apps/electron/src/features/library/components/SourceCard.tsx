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
  ChevronUp,
  Wand2,
  AudioLines,
  EyeOff,
  Eye
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AudioPlayer } from '@/components/AudioPlayer'
import { formatDateTime, formatDuration, formatBytes } from '@/lib/utils'
import { parseJsonArray, Transcript, Meeting } from '@/types'
import { UnifiedRecording, hasLocalPath, isDeviceOnly, isRecordingBacked } from '@/types/unified-recording'
import { LABEL_DELETE_FROM_DEVICE, LABEL_MOVE_TO_TRASH } from '@/features/library/utils/deletionCopy'
import { StatusIcon } from './StatusIcon'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
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
  onMarkPersonal?: () => void
  onTranscribe?: () => void
  onReprocessVibeVoice?: () => void
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
  onMarkPersonal,
  onTranscribe,
  onReprocessVibeVoice,
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
    <Card
      className={`${isSelected ? 'ring-2 ring-primary' : ''} cursor-pointer`}
      onClick={handleCardClick}
      data-testid="source-card"
      role="option"
      aria-selected={isPlaying || isSelected}
      tabIndex={0}
    >
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

            {/* Transcribe button - for local recordings without transcript */}
            {hasLocalPath(recording) && recording.transcriptionStatus !== 'complete' && onTranscribe && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onTranscribe}
                disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
                title={
                  recording.transcriptionStatus === 'pending' ? 'Transcription queued' :
                  recording.transcriptionStatus === 'processing' ? 'Transcription in progress' :
                  'Transcribe this capture'
                }
              >
                {recording.transcriptionStatus === 'processing' ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
              </Button>
            )}

            {/* Re-transcribe with VibeVoice (local full-file / re-processing) */}
            {hasLocalPath(recording) && onReprocessVibeVoice && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onReprocessVibeVoice}
                disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
                title="Re-transcribe with VibeVoice (local, speaker-diarized)"
              >
                <AudioLines className="h-4 w-4" />
              </Button>
            )}

            {/* Transcription status badge */}
            <TranscriptionStatusBadge status={recording.transcriptionStatus} />

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

            {/* Mark personal (ignore) — reversible, non-destructive */}
            {onMarkPersonal && recording.location !== 'device-only' && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                onClick={onMarkPersonal}
                title={recording.personal ? 'Unmark personal' : 'Mark personal — exclude from AI processing'}
                aria-label={recording.personal ? 'Unmark personal' : 'Mark personal'}
              >
                {recording.personal ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            )}

            {/* Delete button — spec-005/F17 T5 §D3b/AR3-4. Card view is a THIRD delete
                surface; the `title` MUST match what onDelete actually does (routes
                through Library's handleDelete → soft handleDeleteLocal for non-device
                rows, i.e. Move to Trash, never a real delete). Card view intentionally
                does not gain permanent-delete or synced device-delete affordances —
                the list row + reader carry the full set (documented limitation).
                AR3-4: capture-only synthetic rows (no source recording) show no
                delete affordance at all. */}
            {isRecordingBacked(recording) && (
              <Button
                variant="ghost"
                size="icon"
                className={
                  recording.location === 'device-only'
                    ? 'text-destructive hover:text-destructive'
                    : 'text-orange-500 hover:text-orange-600'
                }
                onClick={onDelete}
                disabled={(recording.location === 'device-only' && !deviceConnected) || isDeleting}
                title={recording.location === 'device-only' ? LABEL_DELETE_FROM_DEVICE : LABEL_MOVE_TO_TRASH}
              >
                {isDeleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Audio Player */}
        {isPlaying && hasLocalPath(recording) && (
          <AudioPlayer recordingId={recording.id} filename={recording.filename} onClose={onStop} />
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
  // C-005: Include recording.location and recording.title to detect download and title changes
  return (
    prevProps.recording.id === nextProps.recording.id &&
    prevProps.recording.location === nextProps.recording.location &&
    prevProps.recording.personal === nextProps.recording.personal &&
    prevProps.recording.transcriptionStatus === nextProps.recording.transcriptionStatus &&
    prevProps.recording.quality === nextProps.recording.quality &&
    prevProps.recording.title === nextProps.recording.title &&
    prevProps.recording.category === nextProps.recording.category &&
    prevProps.recording.duration === nextProps.recording.duration &&
    prevProps.recording.size === nextProps.recording.size &&
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
