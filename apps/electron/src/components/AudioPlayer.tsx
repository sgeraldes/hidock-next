import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, Square, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

interface AudioPlayerProps {
  filePath: string
  filename?: string
  onClose?: () => void
}

export function AudioPlayer({ filePath, filename, onClose }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [audioSrc, setAudioSrc] = useState<string | null>(null)

  // Load audio file
  useEffect(() => {
    const loadAudio = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Read the audio file as base64
        const base64Data = await window.electronAPI.storage.readRecording(filePath)
        if (!base64Data) {
          throw new Error('Failed to read audio file')
        }

        // Determine MIME type from extension
        const ext = filePath.toLowerCase().split('.').pop() || 'wav'
        const mimeTypes: Record<string, string> = {
          wav: 'audio/wav',
          mp3: 'audio/mpeg',
          m4a: 'audio/mp4',
          ogg: 'audio/ogg',
          flac: 'audio/flac'
        }
        const mimeType = mimeTypes[ext] || 'audio/wav'

        // Create data URL
        const dataUrl = `data:${mimeType};base64,${base64Data}`
        setAudioSrc(dataUrl)
        setIsLoading(false)
      } catch (e) {
        console.error('Failed to load audio:', e)
        setError(e instanceof Error ? e.message : 'Failed to load audio')
        setIsLoading(false)
      }
    }

    loadAudio()

    // Cleanup
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
    }
  }, [filePath])

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      setDuration(audio.duration)
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    const handleError = () => {
      setError('Failed to play audio file')
      setIsPlaying(false)
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [audioSrc])

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

  const stop = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
    setIsPlaying(false)
    setCurrentTime(0)
  }, [])

  const seek = useCallback((value: number[]) => {
    if (!audioRef.current || !duration) return
    const newTime = (value[0] / 100) * duration
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }, [duration])

  const handleVolumeChange = useCallback((value: number[]) => {
    if (!audioRef.current) return
    const newVolume = value[0] / 100
    audioRef.current.volume = newVolume
    setVolume(newVolume)
    if (newVolume === 0) {
      setIsMuted(true)
    } else if (isMuted) {
      setIsMuted(false)
    }
  }, [isMuted])

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return
    if (isMuted) {
      audioRef.current.volume = volume || 0.5
      setIsMuted(false)
    } else {
      audioRef.current.volume = 0
      setIsMuted(true)
    }
  }, [isMuted, volume])

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4 bg-muted rounded-lg">
        <p className="text-sm text-muted-foreground">Loading audio...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-between p-4 bg-destructive/10 rounded-lg">
        <p className="text-sm text-destructive">{error}</p>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 bg-muted rounded-lg space-y-3">
      {/* Hidden audio element */}
      {audioSrc && <audio ref={audioRef} src={audioSrc} preload="metadata" />}

      {/* Filename if provided */}
      {filename && <p className="text-sm font-medium truncate">{filename}</p>}

      {/* Progress bar */}
      <div className="space-y-1">
        <Slider
          value={[duration > 0 ? (currentTime / duration) * 100 : 0]}
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
          <Button variant="ghost" size="icon" onClick={stop}>
            <Square className="h-4 w-4" />
          </Button>
        </div>

        {/* Volume control */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleMute}>
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume * 100]}
            onValueChange={handleVolumeChange}
            max={100}
            step={1}
            className="w-20"
          />
        </div>

        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  )
}
