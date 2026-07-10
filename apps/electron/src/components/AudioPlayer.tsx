import { useCallback, useState } from 'react'
import { Play, Pause, Square, X, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useUIStore } from '@/store/useUIStore'
import { useAudioControls } from '@/components/OperationController'
import { WaveformCanvas } from '@/components/WaveformCanvas'
import { formatTimestamp } from '@/utils/audioUtils'

interface AudioPlayerProps {
  filename?: string
  /**
   * The recording this player is showing. When provided, waveform/loading/error
   * states are scoped to it, so a different recording's stale error or waveform
   * (these live in global store fields) never bleeds onto this one.
   */
  recordingId?: string
  /**
   * Local file path for this recording. Required for the Play button to do the
   * INITIAL load+play when this recording isn't already the one loaded in the
   * shared audio engine (fresh open). When absent (device-only, not downloaded)
   * and nothing is loaded, the Play button is disabled ("Download to play").
   * Thread it from the same source the file-list uses:
   * `hasLocalPath(recording) ? recording.localPath : undefined`.
   */
  filePath?: string
  onClose?: () => void
}

/**
 * AudioPlayer component - Enhanced player with waveform visualization
 *
 * The actual audio playback is handled by OperationController.
 * This component displays the playback state, waveform, and controls.
 */
export function AudioPlayer({ filename, recordingId, filePath, onClose }: AudioPlayerProps) {
  // Read playback state from UIStore
  const isPlaying = useUIStore((state) => state.isPlaying)
  const currentlyPlayingId = useUIStore((state) => state.currentlyPlayingId)
  const currentTime = useUIStore((state) => state.playbackCurrentTime)
  const duration = useUIStore((state) => state.playbackDuration)
  const playbackWaveformData = useUIStore((state) => state.playbackWaveformData)
  const sentimentData = useUIStore((state) => state.playbackSentimentData)

  // Read waveform loading state from UIStore
  const waveformLoadingId = useUIStore((state) => state.waveformLoadingId)
  const rawWaveformError = useUIStore((state) => state.waveformLoadingError)
  const waveformErrorForId = useUIStore((state) => state.waveformErrorForId)
  const waveformLoadedForId = useUIStore((state) => state.waveformLoadedForId)

  // Scope global waveform state to this recording (when known) so a different
  // recording's stale waveform/error/loading never shows here.
  const isForThis = (id: string | null) => !recordingId || id === recordingId
  const waveformData = isForThis(waveformLoadedForId) ? playbackWaveformData : null
  const waveformLoadingError = isForThis(waveformErrorForId) ? rawWaveformError : null
  const isLoadingThis = !!waveformLoadingId && isForThis(waveformLoadingId)

  // Get audio controls from OperationController
  const audioControls = useAudioControls()

  // Local state for playback speed
  const [playbackRate, setPlaybackRate] = useState('1')

  // Is THIS recording the one currently loaded in the shared audio engine?
  // When no recordingId is provided (legacy mount sites that only render while
  // their own recording is playing), treat it as loaded so pause/resume works.
  const isLoaded = !recordingId || currentlyPlayingId === recordingId

  // The Play button can act when: this recording is already loaded (pause/resume),
  // OR it isn't loaded but we have what we need to load+play it (id + local path).
  const canPlayThis = isLoaded || (!!recordingId && !!filePath)

  const togglePlay = useCallback(() => {
    if (isLoaded) {
      // Already the active recording — just pause/resume.
      if (isPlaying) {
        audioControls.pause()
      } else {
        audioControls.resume()
      }
    } else if (recordingId && filePath) {
      // Fresh open: nothing loaded yet for this recording. Do the initial
      // load+play, which also kicks off the waveform generation the panel
      // promises ("Press Play to load the waveform").
      audioControls.play(recordingId, filePath)
    }
  }, [isLoaded, isPlaying, audioControls, recordingId, filePath])

  const handleStop = useCallback(() => {
    audioControls.stop()
  }, [audioControls])

  const seekAudio = useCallback(
    (time: number) => {
      if (!duration || duration <= 0) return
      audioControls.seek(time)
    },
    [duration, audioControls]
  )

  const skipBackward = useCallback(() => {
    const newTime = Math.max(0, currentTime - 10)
    audioControls.seek(newTime)
  }, [currentTime, audioControls])

  const skipForward = useCallback(() => {
    const newTime = Math.min(duration, currentTime + 10)
    audioControls.seek(newTime)
  }, [currentTime, duration, audioControls])

  const handlePlaybackRateChange = useCallback(
    (value: string) => {
      setPlaybackRate(value)
      audioControls.setPlaybackRate(parseFloat(value))
    },
    [audioControls]
  )

  return (
    <div className="p-4 bg-muted rounded-lg space-y-3">
      {/* Filename if provided */}
      {filename && <p className="text-sm font-medium truncate">{filename}</p>}

      {/* Waveform visualization */}
      {waveformData ? (
        <WaveformCanvas
          audioData={waveformData}
          sentimentData={sentimentData || undefined}
          currentTime={currentTime}
          duration={duration}
          onSeek={seekAudio}
          height={80}
        />
      ) : waveformLoadingError ? (
        <div className="h-20 bg-destructive/10 rounded flex flex-col items-center justify-center gap-1 text-sm">
          <p className="text-destructive">Failed to load waveform</p>
          <p className="text-xs text-muted-foreground">{waveformLoadingError}</p>
        </div>
      ) : isLoadingThis ? (
        <div className="h-20 bg-background rounded flex items-center justify-center">
          <div className="flex gap-1 items-end h-12">
            {Array.from({ length: 40 }).map((_, i) => (
              <div
                key={i}
                className="w-1 bg-muted-foreground/30 rounded motion-safe:animate-pulse"
                style={{
                  height: `${((i * 37) % 100)}%`,
                  animationDelay: `${i * 20}ms`
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="h-20 bg-background rounded flex items-center justify-center text-sm text-muted-foreground">
          {filename ? 'Press Play to load the waveform' : 'Select a recording to view waveform'}
        </div>
      )}

      {/* Time display */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatTimestamp(currentTime)}</span>
        <span>{formatTimestamp(duration)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        {/* Playback controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={skipBackward}
            disabled={currentTime <= 0}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={togglePlay}
            disabled={!canPlayThis}
            title={canPlayThis ? undefined : 'Download to play'}
            className="h-10 w-10"
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={skipForward}
            disabled={currentTime >= duration}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleStop}>
            <Square className="h-4 w-4" />
          </Button>
        </div>

        {/* Playback speed and close */}
        <div className="flex items-center gap-2">
          <Select value={playbackRate} onValueChange={handlePlaybackRateChange}>
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">0.5×</SelectItem>
              <SelectItem value="1">1×</SelectItem>
              <SelectItem value="1.5">1.5×</SelectItem>
              <SelectItem value="2">2×</SelectItem>
            </SelectContent>
          </Select>

          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4 mr-1" />
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
