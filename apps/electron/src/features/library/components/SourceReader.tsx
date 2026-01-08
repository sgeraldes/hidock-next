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

import { useState } from 'react'
import { TranscriptViewer } from './TranscriptViewer'
import { UnifiedRecording, hasLocalPath } from '@/types/unified-recording'
import { Transcript, parseJsonArray } from '@/types'
import { Play, Pause, Volume2, Calendar, Clock, HardDrive, Tag, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { formatDuration } from '@/lib/utils'

interface SourceReaderProps {
  recording: UnifiedRecording | null
  transcript?: Transcript
  isPlaying?: boolean
  currentTimeMs?: number
  onPlay?: () => void
  onStop?: () => void
  onSeek?: (startMs: number, endMs?: number) => void
}

export function SourceReader({
  recording,
  transcript,
  isPlaying = false,
  currentTimeMs = 0,
  onPlay,
  onStop,
  onSeek
}: SourceReaderProps) {
  const [volume, setVolume] = useState(100)

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

  const fileSize = recording.size > 0 ? `${(recording.size / 1024 / 1024).toFixed(1)} MB` : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with recording metadata */}
      <div className="p-6 border-b space-y-4">
        <div>
          <h2 className="text-xl font-semibold mb-2" title={recording.filename}>
            {recording.title || recording.filename}
          </h2>

          {/* Tags/Category */}
          {recording.category && (
            <div className="flex items-center gap-2 mb-3">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                {recording.category}
              </span>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {/* Duration */}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{formatDuration(recording.duration)}</span>
            </div>

            {/* Date */}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>{new Date(recording.dateRecorded).toLocaleDateString()}</span>
            </div>

            {/* File Size */}
            {fileSize && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <HardDrive className="h-4 w-4" />
                <span>{fileSize}</span>
              </div>
            )}
          </div>

          {/* Linked Meeting */}
          {recording.meetingSubject && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Meeting:</span>
              <span className="font-medium truncate">{recording.meetingSubject}</span>
            </div>
          )}
        </div>
      </div>

      {/* Audio Player Controls */}
      {canPlay && (
        <div className="p-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            {/* Play/Pause Button */}
            <Button
              size="sm"
              variant="outline"
              onClick={isPlaying ? onStop : onPlay}
              className="flex-shrink-0"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>

            {/* Progress Bar */}
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-1">
                {formatDuration(currentTimeMs / 1000)} / {recording.duration > 0 ? formatDuration(recording.duration) : '--:--'}
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${recording.duration > 0 ? (currentTimeMs / (recording.duration * 1000)) * 100 : 0}%`
                  }}
                />
              </div>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-2 flex-shrink-0 w-32">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <Slider
                value={[volume]}
                onValueChange={(values) => setVolume(values[0])}
                max={100}
                step={1}
                className="flex-1"
              />
            </div>
          </div>
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
