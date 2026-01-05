/**
 * SourceDetailDrawer Component
 *
 * A slide-out drawer for viewing and interacting with a Source's details.
 * Shows transcript, summary, metadata, and provides actions.
 */

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, FileText, Wand2, Calendar, Download, Trash2, ExternalLink, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AudioPlayer } from '@/components/AudioPlayer'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { parseJsonArray } from '@/types'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { useLibraryStore } from '@/store/useLibraryStore'
import { getRecoveryAction } from '@/features/library/utils/errorHandling'

interface Transcript {
  id: string
  recording_id: string
  full_text: string
  language: string
  summary?: string
  action_items?: string
  topics?: string
  key_points?: string
  sentiment?: string
  speakers?: string
  word_count?: number
  transcription_provider?: string
  transcription_model?: string
  created_at: string
}

interface Meeting {
  id: string
  subject: string
  start_time: string
}

interface SourceDetailDrawerProps {
  source: UnifiedRecording | null
  transcript?: Transcript
  meeting?: Meeting
  isOpen: boolean
  isPlaying: boolean
  onClose: () => void
  onPlay: () => void
  onStop: () => void
  onTranscribe: () => void
  onDownload: () => void
  onDelete: () => void
  onNavigateToMeeting?: (meetingId: string) => void
  onAskAssistant?: () => void
  deviceConnected: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function SourceDetailDrawer({
  source,
  transcript,
  meeting,
  isOpen,
  isPlaying,
  onClose,
  onPlay,
  onStop,
  onTranscribe,
  onDownload,
  onDelete,
  onNavigateToMeeting,
  onAskAssistant,
  deviceConnected
}: SourceDetailDrawerProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [errorDetailsExpanded, setErrorDetailsExpanded] = useState(false)

  const error = useLibraryStore((state) => (source ? state.recordingErrors.get(source.id) : undefined))
  const clearRecordingError = useLibraryStore((state) => state.clearRecordingError)

  const recoveryAction = error ? getRecoveryAction(error.type) : null

  // Focus management: store focus and restore on close
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [isOpen])

  if (!source) return null

  const canPlay = hasLocalPath(source)
  const needsDownload = isDeviceOnly(source)
  const needsTranscription =
    hasLocalPath(source) && (source.transcriptionStatus === 'none' || source.transcriptionStatus === 'error')

  const handleRetry = () => {
    if (!source) return
    clearRecordingError(source.id)
    if (recoveryAction?.action === 'retry') {
      if (error?.type.includes('transcription')) {
        onTranscribe()
      } else if (error?.type.includes('download')) {
        onDownload()
      }
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full sm:max-w-md md:max-w-lg overflow-y-auto"
        aria-describedby="source-detail-description"
      >
        <SheetHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-semibold pr-8 truncate">
              {source.title || source.filename}
            </SheetTitle>
          </div>
          <SheetDescription id="source-detail-description">
            {formatDateTime(source.dateRecorded.toISOString())}
            {source.size && ` • ${formatBytes(source.size)}`}
            {source.duration && ` • ${formatDuration(source.duration)}`}
          </SheetDescription>
        </SheetHeader>

        {/* Status badges */}
        <div className="flex flex-wrap gap-2 mt-4">
          {/* Location badge */}
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              source.location === 'device-only'
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                : source.location === 'local-only'
                  ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                  : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
            }`}
          >
            {source.location === 'device-only' ? 'On Device' : source.location === 'local-only' ? 'Local' : 'Synced'}
          </span>

          {/* Transcription status badge */}
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              source.transcriptionStatus === 'complete'
                ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                : source.transcriptionStatus === 'pending' || source.transcriptionStatus === 'processing'
                  ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                  : source.transcriptionStatus === 'error'
                    ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                    : 'bg-secondary'
            }`}
          >
            {source.transcriptionStatus === 'none' ? 'Not transcribed' : source.transcriptionStatus}
          </span>

          {/* Quality badge */}
          {source.quality && (
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                source.quality === 'valuable'
                  ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                  : source.quality === 'archived'
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                    : 'bg-secondary'
              }`}
            >
              {source.quality}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mt-4 border-b pb-4">
          {/* Play/Stop */}
          <Button
            variant="outline"
            size="sm"
            onClick={isPlaying ? onStop : onPlay}
            disabled={!canPlay}
            className="gap-2"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isPlaying ? 'Stop' : 'Play'}
          </Button>

          {/* Download */}
          {needsDownload && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              disabled={!deviceConnected}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}

          {/* Transcribe */}
          {needsTranscription && (
            <Button variant="outline" size="sm" onClick={onTranscribe} className="gap-2">
              <Wand2 className="h-4 w-4" />
              Transcribe
            </Button>
          )}

          {/* Ask Assistant */}
          {onAskAssistant && (
            <Button variant="outline" size="sm" onClick={onAskAssistant} className="gap-2">
              <FileText className="h-4 w-4" />
              Ask Assistant
            </Button>
          )}

          {/* Delete */}
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={source.location === 'device-only' && !deviceConnected}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>

        {/* Error message with retry */}
        {error && (
          <div className="mt-4 border-t pt-4">
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-900 dark:text-red-100">{error.message}</p>
                {error.details && <p className="text-xs text-red-700 dark:text-red-300 mt-1">{error.details}</p>}

                {/* Expandable error details */}
                <button
                  onClick={() => setErrorDetailsExpanded(!errorDetailsExpanded)}
                  className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 mt-2 hover:underline"
                >
                  {errorDetailsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {errorDetailsExpanded ? 'Hide details' : 'Show details'}
                </button>

                {errorDetailsExpanded && (
                  <div className="mt-2 p-2 bg-red-100 dark:bg-red-900 rounded text-xs space-y-1">
                    <div><span className="font-medium">Type:</span> {error.type}</div>
                    <div><span className="font-medium">Recoverable:</span> {error.recoverable ? 'Yes' : 'No'}</div>
                    <div><span className="font-medium">Retryable:</span> {error.retryable ? 'Yes' : 'No'}</div>
                    {error.sourceId && <div><span className="font-medium">Source ID:</span> {error.sourceId}</div>}
                  </div>
                )}
              </div>
              {error.retryable && recoveryAction && (
                <Button variant="outline" size="sm" onClick={handleRetry} className="shrink-0">
                  {recoveryAction.label}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Audio Player (sticky when playing) */}
        {isPlaying && canPlay && (
          <div className="sticky top-0 bg-background z-10 py-4 border-b">
            <AudioPlayer filename={source.filename} onClose={onStop} />
          </div>
        )}

        {/* Linked Meeting */}
        {meeting && onNavigateToMeeting && (
          <div
            className="flex items-center gap-2 p-3 mt-4 bg-muted rounded-lg cursor-pointer hover:bg-muted/80"
            onClick={() => onNavigateToMeeting(meeting.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onNavigateToMeeting(meeting.id)}
          >
            <Calendar className="h-4 w-4 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">{meeting.subject}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(meeting.start_time)}</p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

        {/* Content Tabs */}
        {transcript ? (
          <Tabs defaultValue="transcript" className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="transcript" className="flex-1">
                Transcript
              </TabsTrigger>
              <TabsTrigger value="summary" className="flex-1">
                Summary
              </TabsTrigger>
              <TabsTrigger value="details" className="flex-1">
                Details
              </TabsTrigger>
            </TabsList>

            <TabsContent value="transcript" className="mt-4 space-y-4">
              {/* Summary */}
              {transcript.summary && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                  <p className="text-sm">{transcript.summary}</p>
                </div>
              )}

              {/* Full transcript */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Full Transcript{transcript.word_count && ` (${transcript.word_count} words)`}
                </p>
                <div className="p-3 bg-muted rounded-lg max-h-96 overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap">{transcript.full_text}</p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="summary" className="mt-4 space-y-4">
              {/* Action Items */}
              {transcript.action_items && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Action Items</p>
                  <ul className="list-disc list-inside text-sm space-y-1 bg-muted p-3 rounded-lg">
                    {parseJsonArray<string>(transcript.action_items).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Key Points */}
              {transcript.key_points && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Key Points</p>
                  <ul className="list-disc list-inside text-sm space-y-1 bg-muted p-3 rounded-lg">
                    {parseJsonArray<string>(transcript.key_points).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Topics */}
              {transcript.topics && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Topics</p>
                  <div className="flex flex-wrap gap-1">
                    {parseJsonArray<string>(transcript.topics).map((topic, i) => (
                      <span key={i} className="px-2 py-0.5 bg-secondary text-xs rounded-full">
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!transcript.action_items && !transcript.key_points && !transcript.topics && (
                <p className="text-sm text-muted-foreground">No summary data available for this transcript.</p>
              )}
            </TabsContent>

            <TabsContent value="details" className="mt-4">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Filename</dt>
                  <dd className="mt-1">{source.filename}</dd>
                </div>
                {source.duration && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Duration</dt>
                    <dd className="mt-1">{formatDuration(source.duration)}</dd>
                  </div>
                )}
                {source.size && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Size</dt>
                    <dd className="mt-1">{formatBytes(source.size)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Recorded</dt>
                  <dd className="mt-1">{formatDateTime(source.dateRecorded.toISOString())}</dd>
                </div>
                {transcript.language && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Language</dt>
                    <dd className="mt-1">{transcript.language}</dd>
                  </div>
                )}
                {transcript.transcription_provider && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Transcription Provider</dt>
                    <dd className="mt-1">
                      {transcript.transcription_provider}
                      {transcript.transcription_model && ` (${transcript.transcription_model})`}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Transcribed</dt>
                  <dd className="mt-1">{formatDateTime(transcript.created_at)}</dd>
                </div>
              </dl>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="mt-4">
            {needsDownload ? (
              <div className="text-center py-8 text-muted-foreground">
                <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">Download this capture to view its transcript.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDownload}
                  disabled={!deviceConnected}
                  className="mt-4"
                >
                  Download from Device
                </Button>
              </div>
            ) : needsTranscription ? (
              <div className="text-center py-8 text-muted-foreground">
                <Wand2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">This capture hasn't been transcribed yet.</p>
                <Button variant="outline" size="sm" onClick={onTranscribe} className="mt-4">
                  Start Transcription
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">No transcript available.</p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
