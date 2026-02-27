/**
 * SourceReader Component
 *
 * Displays the selected recording in the center panel with:
 * - Audio playback controls
 * - Transcript viewer with timestamps
 * - Metadata display
 *
 * Shows a placeholder message when no recording is selected.
 */

import { TranscriptViewer } from './TranscriptViewer'
import { AudioPlayer } from '@/components/AudioPlayer'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { Transcript, Meeting, parseJsonArray } from '@/types'
import { Calendar, Download, Trash2, Wand2, RefreshCw, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatDuration, formatBytes } from '@/lib/utils'

interface SourceReaderProps {
  recording: UnifiedRecording | null
  transcript?: Transcript
  meeting?: Meeting
  isPlaying?: boolean
  currentTimeMs?: number
  onPlay?: () => void
  onStop?: () => void
  onSeek?: (startMs: number, endMs?: number) => void
  // Action button callbacks
  onDownload?: () => void
  onTranscribe?: () => void
  onDelete?: () => void
  // State for button enabling/disabling
  deviceConnected?: boolean
  isDownloading?: boolean
  downloadProgress?: number
  isDeleting?: boolean
  // Navigation
  onNavigateToMeeting?: (meetingId: string) => void
}

export function SourceReader({
  recording,
  transcript,
  meeting,
  isPlaying = false,
  currentTimeMs = 0,
  onPlay,
  onStop,
  onSeek,
  onDownload,
  onTranscribe,
  onDelete,
  deviceConnected = false,
  isDownloading = false,
  downloadProgress,
  isDeleting = false,
  onNavigateToMeeting
}: SourceReaderProps) {

  if (!recording) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">No recording selected</p>
          <p className="text-sm">Select a recording from the list to view details</p>
        </div>
      </div>
    )
  }

  const canPlay = hasLocalPath(recording)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with comprehensive metadata */}
      <div className="p-6 border-b space-y-4">
        <div>
          <h2 className="text-xl font-semibold mb-4" title={recording.filename}>
            {recording.title || recording.filename}
          </h2>

          {/* Comprehensive Metadata Grid - same as SourceRowExpanded */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
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
            {recording.title && recording.filename !== recording.title && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Filename</p>
                <p className="truncate" title={recording.filename}>{recording.filename}</p>
              </div>
            )}
          </div>

          {/* Linked Meeting */}
          {meeting && (
            <div
              className="mt-4 flex items-center gap-2 p-3 bg-muted/30 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onNavigateToMeeting?.(meeting.id)}
            >
              <Calendar className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{meeting.subject}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(meeting.start_time)}</p>
              </div>
            </div>
          )}

          {/* Transcript Summary */}
          {transcript?.summary && (
            <div className="mt-4 p-3 bg-muted/30 border rounded-lg">
              <p className="text-xs font-medium text-muted-foreground mb-2">Summary</p>
              <p className="text-sm leading-relaxed">{transcript.summary}</p>
            </div>
          )}

          {/* Device-only notice */}
          {isDeviceOnly(recording) && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              Download this capture to play it and generate a transcript.
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons Section */}
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b bg-muted/30">
        {/* Play/Stop Button - only for local recordings - LB-03 fix: Wire up onPlay callback */}
        {canPlay && onPlay && (
          isPlaying ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onStop}
              className="gap-2"
              title="Stop playback"
            >
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onPlay}
              className="gap-2"
              title="Play recording"
            >
              <Play className="h-4 w-4" />
              Play
            </Button>
          )
        )}

        {/* Download Button - only for device-only recordings */}
        {isDeviceOnly(recording) && onDownload && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDownload}
            disabled={!deviceConnected || isDownloading}
            className="gap-2"
            title={!deviceConnected ? "Device not connected" : "Download recording from device"}
          >
            {isDownloading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                {downloadProgress !== undefined ? `${downloadProgress}%` : 'Downloading...'}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download
              </>
            )}
          </Button>
        )}

        {/* Transcribe Button - only for local recordings without transcript */}
        {hasLocalPath(recording) && recording.transcriptionStatus !== 'complete' && onTranscribe && (
          <Button
            variant="outline"
            size="sm"
            onClick={onTranscribe}
            disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
            className="gap-2"
            title={
              recording.transcriptionStatus === 'pending' ? "Transcription queued" :
              recording.transcriptionStatus === 'processing' ? "Transcription in progress" :
              "Start AI transcription"
            }
          >
            {recording.transcriptionStatus === 'processing' ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                In Progress
              </>
            ) : recording.transcriptionStatus === 'pending' ? (
              <>
                <RefreshCw className="h-4 w-4" />
                Queued
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />
                Transcribe
              </>
            )}
          </Button>
        )}

        {/* Delete Button - always available */}
        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={(isDeviceOnly(recording) && !deviceConnected) || isDeleting}
            className="gap-2 text-destructive hover:text-destructive"
            title={
              isDeviceOnly(recording) && !deviceConnected ? "Device not connected" :
              isDeleting ? "Deleting..." :
              "Delete recording"
            }
          >
            {isDeleting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete
          </Button>
        )}
      </div>

      {/* Audio Player — only shown after playback has been initiated */}
      {canPlay && isPlaying && (
        <div className="sticky top-0 bg-background z-10 border-b">
          <AudioPlayer key={recording.id} filename={recording.filename} onClose={onStop} />
        </div>
      )}

      {/* Transcript Content */}
      <div className="flex-1 overflow-auto p-4">
        {transcript ? (
          <TranscriptViewer
            transcript={transcript.full_text}
            currentTimeMs={currentTimeMs}
            onSeek={onSeek || (() => {})}
            showSummary={true}
            showActionItems={true}
            summary={transcript.summary ?? undefined}
            actionItems={parseJsonArray<string>(transcript.action_items)}
          />
        ) : recording.transcriptionStatus === 'complete' ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Transcript not available</p>
          </div>
        ) : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing' ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Transcription in progress...</p>
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            <p>No transcript available</p>
            {canPlay && (
              <p className="text-sm mt-2">
                Click &quot;Transcribe&quot; to generate a transcript
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
