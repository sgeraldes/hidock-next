import { useCallback } from 'react'
import { Play, Pause, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useUIStore } from '@/store/useUIStore'
import { useAudioControls } from '@/components/OperationController'

interface AudioPlayerProps {
  filename?: string
  onClose?: () => void
}

/**
 * AudioPlayer component - UI-only player that reads from UIStore
 *
 * The actual audio playback is handled by OperationController.
 * This component just displays the playback state and controls.
 */
export function AudioPlayer({ filename, onClose }: AudioPlayerProps) {
  // Read playback state from UIStore
  const isPlaying = useUIStore((state) => state.isPlaying)
  const currentTime = useUIStore((state) => state.playbackCurrentTime)
  const duration = useUIStore((state) => state.playbackDuration)

  // Get audio controls from OperationController
  const audioControls = useAudioControls()

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

  const seek = useCallback((value: number[]) => {
    if (!duration || duration <= 0) return
    const newTime = (value[0] / 100) * duration
    audioControls.seek(newTime)
  }, [duration, audioControls])

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Calculate progress percentage
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="p-4 bg-muted rounded-lg space-y-3">
      {/* Filename if provided */}
      {filename && <p className="text-sm font-medium truncate">{filename}</p>}

      {/* Progress bar */}
      <div className="space-y-1">
        <Slider
          value={[progress]}
          onValueChange={seek}
          max={100}
          step={0.1}
          className="cursor-pointer"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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
          <Button variant="ghost" size="icon" onClick={handleStop}>
            <Square className="h-4 w-4" />
          </Button>
        </div>

        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
        )}
      </div>
    </div>
  )
}
