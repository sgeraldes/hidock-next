import { useState, useRef, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { useTranscriptStore } from "../store/useTranscriptStore";

interface AudioPlayerProps {
  sessionId: string;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ sessionId }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let blobUrl: string | null = null;

    const loadAudio = async () => {
      setLoading(true);
      setError(null);

      try {
        // PLY-002: Read audio file via IPC as buffer (file:// URLs are blocked by Electron)
        const result = await window.electronAPI.audio.readFile(sessionId);

        if (!mounted) return;

        if (!result) {
          setError("No audio recording available for this session");
          setLoading(false);
          return;
        }

        // Create a blob URL from the buffer data
        const blob = new Blob([result.data], { type: result.mimeType });
        blobUrl = URL.createObjectURL(blob);
        setAudioSrc(blobUrl);
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        console.error('[AudioPlayer] Failed to load audio:', err);
        setError(err instanceof Error ? err.message : 'Failed to load audio');
        setLoading(false);
      }
    };

    loadAudio();

    return () => {
      mounted = false;
      // Revoke blob URL to free memory
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [sessionId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // Update store for audio-text sync
      useTranscriptStore.getState().setPlaybackTimeMs(audio.currentTime * 1000);
    };
    const handleDurationChange = () => {
      if (isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      useTranscriptStore.getState().setPlaybackTimeMs(0);
    };
    const handlePause = () => {
      useTranscriptStore.getState().setPlaybackTimeMs(0);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);

    // If duration is already available (cached or preloaded), read it now
    if (isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      // Reset on unmount
      useTranscriptStore.getState().setPlaybackTimeMs(0);
    };
  }, [audioSrc]);

  const togglePlay = async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.error("[AudioPlayer] Play failed:", err);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const skip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(
        0,
        Math.min(duration, audioRef.current.currentTime + seconds),
      );
    }
  };

  const changeSpeed = () => {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = speeds.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const newSpeed = speeds[nextIndex];
    setPlaybackRate(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 bg-card border-b border-border">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-3 text-sm text-muted-foreground">
          Loading audio...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-card border-b border-border">
        <div className="px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            ⚠️ {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border-b border-border p-4">
      {audioSrc && <audio ref={audioRef} src={audioSrc} />}

      <div className="flex items-center gap-4">
        {/* Playback controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => skip(-10)}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
            title="Skip backward 10s"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={togglePlay}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>

          <button
            onClick={() => skip(10)}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
            title="Skip forward 10s"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Time display */}
        <div className="flex items-center gap-2 text-sm font-mono tabular-nums text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <span>/</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Seek bar */}
        <div className="flex-1">
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer bg-secondary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        {/* Playback speed */}
        <button
          onClick={changeSpeed}
          className="px-3 py-1.5 rounded text-xs font-medium bg-secondary hover:bg-secondary/80 transition-colors"
          title="Change playback speed"
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
}
