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
  onClose?: () => void
}

/**
 * AudioPlayer component - Enhanced player with waveform visualization
 *
 * The actual audio playback is handled by OperationController.
 * This component displays the playback state, waveform, and controls.
 */
export function AudioPlayer({ filename, onClose }: AudioPlayerProps) {
  // Read playback state from UIStore
  const isPlaying = useUIStore((state) => state.isPlaying)
  const currentTime = useUIStore((state) => state.playbackCurrentTime)
  const duration = useUIStore((state) => state.playbackDuration)
  const waveformData = useUIStore((state) => state.playbackWaveformData)
  const sentimentData = useUIStore((state) => state.playbackSentimentData)

  // Get audio controls from OperationController
  const audioControls = useAudioControls()

  // Local state for playback speed
  const [playbackRate, setPlaybackRate] = useState('1')

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      audioControls.pause()
    } else {
      audioControls.resume()
    }
  }, [isPlaying, audioControls])

  const handleStop = useCallback(() => {
    audioControls.stop()
    onClose?.()
  }, [audioControls, onClose])

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
      // Note: Actual playback rate control would need to be implemented in OperationController
      // For now, we just update the UI state
      console.log('Playback rate changed to:', value)
    },
    []
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
      ) : (
        <div className="h-20 bg-background rounded flex items-center justify-center text-sm text-muted-foreground">
          Loading waveform...
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
