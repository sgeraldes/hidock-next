import { formatDuration } from '@/utils/formatters';
import {
  Download,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

export interface PlaybackSpeed {
  value: number;
  label: string;
}

export interface AudioPlayerProps {
  src: string;
  title: string;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  onVolumeChange?: (volume: number) => void;
  onSpeedChange?: (speed: number) => void;
  className?: string;
  showAdvancedControls?: boolean;
  showVisualization?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  playbackSpeed?: number;
  volume?: number;
  disabled?: boolean;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  title,
  onEnded,
  onPlay,
  onPause,
  onSeek,
  onVolumeChange,
  onSpeedChange,
  className = '',
  showAdvancedControls = false,
  showVisualization = false,
  autoPlay = false,
  loop = false,
  playbackSpeed = 1.0,
  volume: initialVolume = 1.0,
  disabled = false
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const audioContextRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const sourceRef = useRef<MediaElementAudioSourceNode>();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(initialVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(loop);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState(playbackSpeed);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [buffered, setBuffered] = useState(0);

  // Advanced playback features
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'one' | 'all'>('off');
  const [bookmarks, setBookmarks] = useState<number[]>([]);

  const playbackSpeeds: PlaybackSpeed[] = [
    { value: 0.25, label: '0.25x' },
    { value: 0.5, label: '0.5x' },
    { value: 0.75, label: '0.75x' },
    { value: 1.0, label: '1x' },
    { value: 1.25, label: '1.25x' },
    { value: 1.5, label: '1.5x' },
    { value: 2.0, label: '2x' }
  ];

  // Initialize audio context for visualization
  const initializeAudioContext = useCallback(() => {
    if (!showVisualization || !audioRef.current) return;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      if (!sourceRef.current) {
        sourceRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;

        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
      }
    } catch (error) {
      console.error('Failed to initialize audio context:', error);
    }
  }, [showVisualization]);

  // Visualization animation
  const drawVisualization = useCallback(() => {
    if (!canvasRef.current || !analyserRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isPlaying) return;

      analyserRef.current!.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

        const r = barHeight + 25 * (i / bufferLength);
        const g = 250 * (i / bufferLength);
        const b = 50;

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Set initial properties
    audio.volume = volume;
    audio.loop = isLooping;
    audio.playbackRate = currentSpeed;

    if (autoPlay) {
      audio.autoplay = true;
    }

    const handleLoadStart = () => setIsLoading(true);
    const handleCanPlay = () => {
      setIsLoading(false);
      initializeAudioContext();
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      if (autoPlay && !disabled) {
        audio.play().catch(console.error);
      }
    };
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      onSeek?.(audio.currentTime);

      // Update buffered progress
      if (audio.buffered.length > 0) {
        const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
        setBuffered((bufferedEnd / audio.duration) * 100);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);

      // Handle repeat modes
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play();
        return;
      }

      onEnded?.();
    };
    const handlePlay = () => {
      setIsPlaying(true);
      onPlay?.();
      if (showVisualization) {
        drawVisualization();
      }
    };
    const handlePause = () => {
      setIsPlaying(false);
      onPause?.();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
    const handleError = (e: Event) => {
      console.error('Audio error:', e);
      setIsLoading(false);
      setIsPlaying(false);
    };

    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [onEnded, onPlay, onPause, onSeek, volume, isLooping, currentSpeed, autoPlay, disabled, repeatMode, showVisualization, drawVisualization, initializeAudioContext]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    if (isPlaying) {
      audio.pause();
    } else {
      // Resume audio context if suspended
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      audio.play().catch(console.error);
    }
  }, [isPlaying, disabled]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    const newTime = parseFloat(e.target.value);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
    onSeek?.(newTime);
  }, [disabled, onSeek]);

  const seekToTime = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    const clampedTime = Math.max(0, Math.min(duration, time));
    audio.currentTime = clampedTime;
    setCurrentTime(clampedTime);
    onSeek?.(clampedTime);
  }, [duration, disabled, onSeek]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    const newVolume = parseFloat(e.target.value);
    audio.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    onVolumeChange?.(newVolume);
  }, [disabled, onVolumeChange]);

  const setVolumeLevel = useCallback((newVolume: number) => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    audio.volume = clampedVolume;
    setVolume(clampedVolume);
    setIsMuted(clampedVolume === 0);
    onVolumeChange?.(clampedVolume);
  }, [disabled, onVolumeChange]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    if (isMuted) {
      audio.volume = volume > 0 ? volume : 0.5;
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  }, [isMuted, volume, disabled]);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    const newTime = Math.max(0, Math.min(duration, audio.currentTime + seconds));
    audio.currentTime = newTime;
    setCurrentTime(newTime);
    onSeek?.(newTime);
  }, [duration, disabled, onSeek]);

  const changePlaybackSpeed = useCallback((speed: number) => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    audio.playbackRate = speed;
    setCurrentSpeed(speed);
    onSpeedChange?.(speed);
  }, [disabled, onSpeedChange]);

  const toggleLoop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    const newLoopState = !isLooping;
    audio.loop = newLoopState;
    setIsLooping(newLoopState);
  }, [isLooping, disabled]);

  const cycleRepeatMode = useCallback(() => {
    if (disabled) return;

    const modes: Array<'off' | 'one' | 'all'> = ['off', 'one', 'all'];
    const currentIndex = modes.indexOf(repeatMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setRepeatMode(nextMode);
  }, [repeatMode, disabled]);

  const toggleShuffle = useCallback(() => {
    if (disabled) return;
    setIsShuffleEnabled(!isShuffleEnabled);
  }, [isShuffleEnabled, disabled]);

  const addBookmark = useCallback(() => {
    if (disabled || currentTime === 0) return;

    if (!bookmarks.includes(currentTime)) {
      setBookmarks([...bookmarks, currentTime].sort((a, b) => a - b));
    }
  }, [bookmarks, currentTime, disabled]);

  const removeBookmark = useCallback((time: number) => {
    if (disabled) return;
    setBookmarks(bookmarks.filter(bookmark => bookmark !== time));
  }, [bookmarks, disabled]);

  const jumpToBookmark = useCallback((time: number) => {
    if (disabled) return;
    seekToTime(time);
  }, [seekToTime, disabled]);

  const downloadAudio = useCallback(() => {
    if (disabled) return;

    const link = document.createElement('a');
    link.href = src;
    link.download = title;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [src, title, disabled]);

  const resetToStart = useCallback(() => {
    if (disabled) return;
    seekToTime(0);
  }, [seekToTime, disabled]);

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercentage = duration > 0 ? buffered : 0;

  return (
    <div className={`bg-slate-800 rounded-lg p-4 ${className} ${disabled ? 'opacity-50' : ''}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-slate-100 font-medium truncate">{title}</h3>
          {showAdvancedControls && (
            <div className="text-xs text-slate-400 mt-1">
              Speed: {currentSpeed}x • {repeatMode !== 'off' ? `Repeat: ${repeatMode}` : 'No repeat'}
              {isShuffleEnabled && ' • Shuffle'}
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {showAdvancedControls && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1 hover:bg-slate-700 rounded transition-colors"
              disabled={disabled}
            >
              <Settings className="w-4 h-4 text-slate-400" />
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-slate-700 rounded transition-colors"
            disabled={disabled}
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4 text-slate-400" />
            ) : (
              <Maximize2 className="w-4 h-4 text-slate-400" />
            )}
          </button>
        </div>
      </div>

      {/* Visualization */}
      {showVisualization && (
        <div className="mb-4">
          <canvas
            ref={canvasRef}
            width={400}
            height={100}
            className="w-full h-20 bg-slate-900 rounded"
          />
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="relative">
          {/* Buffered progress */}
          <div
            className="absolute top-0 left-0 h-2 bg-slate-600 rounded-lg pointer-events-none"
            style={{ width: `${bufferedPercentage}%` }}
          />

          {/* Playback progress */}
          <div
            className="absolute top-0 left-0 h-2 bg-primary-500 rounded-lg pointer-events-none"
            style={{ width: `${progressPercentage}%` }}
          />

          {/* Bookmarks */}
          {bookmarks.map((bookmark, index) => (
            <div
              key={index}
              className="absolute top-0 w-1 h-2 bg-yellow-400 cursor-pointer"
              style={{ left: `${(bookmark / duration) * 100}%` }}
              onClick={() => jumpToBookmark(bookmark)}
              title={`Bookmark at ${formatDuration(bookmark)}`}
            />
          ))}

          <input
            type="range"
            min="0"
            max={duration}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer slider relative z-10"
            disabled={isLoading || disabled}
          />
        </div>

        {/* Time Display */}
        <div className="flex justify-between items-center text-sm text-slate-400 mt-1">
          <span>{formatDuration(currentTime)}</span>

          {showAdvancedControls && (
            <button
              onClick={addBookmark}
              className="text-xs hover:text-yellow-400 transition-colors"
              disabled={disabled}
              title="Add bookmark"
            >
              Bookmark
            </button>
          )}

          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Main Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          {/* Advanced skip controls */}
          {showAdvancedControls && (
            <>
              <button
                onClick={() => skip(-30)}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                disabled={isLoading || disabled}
                title="Skip back 30s"
              >
                <Rewind className="w-4 h-4 text-slate-300" />
              </button>

              <button
                onClick={resetToStart}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                disabled={isLoading || disabled}
                title="Reset to start"
              >
                <RotateCcw className="w-4 h-4 text-slate-300" />
              </button>
            </>
          )}

          {/* Skip Back */}
          <button
            onClick={() => skip(-10)}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            disabled={isLoading || disabled}
          >
            <SkipBack className="w-4 h-4 text-slate-300" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlayPause}
            className="p-3 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
            disabled={isLoading || disabled}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5 text-white" />
            ) : (
              <Play className="w-5 h-5 text-white ml-0.5" />
            )}
          </button>

          {/* Skip Forward */}
          <button
            onClick={() => skip(10)}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            disabled={isLoading || disabled}
          >
            <SkipForward className="w-4 h-4 text-slate-300" />
          </button>

          {/* Advanced skip controls */}
          {showAdvancedControls && (
            <button
              onClick={() => skip(30)}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              disabled={isLoading || disabled}
              title="Skip forward 30s"
            >
              <FastForward className="w-4 h-4 text-slate-300" />
            </button>
          )}
        </div>

        {/* Volume Control */}
        <div className="flex items-center space-x-2">
          <button
            onClick={toggleMute}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            disabled={disabled}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-slate-300" />
            ) : (
              <Volume2 className="w-4 h-4 text-slate-300" />
            )}
          </button>

          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer slider"
            disabled={disabled}
          />
        </div>

        {/* Additional Controls */}
        <div className="flex items-center space-x-2">
          {showAdvancedControls && (
            <>
              <button
                onClick={toggleShuffle}
                className={`p-2 hover:bg-slate-700 rounded-lg transition-colors ${isShuffleEnabled ? 'text-primary-400' : 'text-slate-400'
                  }`}
                disabled={disabled}
                title="Toggle shuffle"
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                onClick={cycleRepeatMode}
                className={`p-2 hover:bg-slate-700 rounded-lg transition-colors ${repeatMode !== 'off' ? 'text-primary-400' : 'text-slate-400'
                  }`}
                disabled={disabled}
                title={`Repeat: ${repeatMode}`}
              >
                <Repeat className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            onClick={downloadAudio}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            disabled={disabled}
          >
            <Download className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Advanced Settings Panel */}
      {showSettings && showAdvancedControls && (
        <div className="bg-slate-700 rounded-lg p-3 mb-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Playback Speed */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Playback Speed
              </label>
              <select
                value={currentSpeed}
                onChange={(e) => changePlaybackSpeed(parseFloat(e.target.value))}
                className="w-full bg-slate-600 text-slate-100 rounded px-2 py-1 text-sm"
                disabled={disabled}
              >
                {playbackSpeeds.map((speed) => (
                  <option key={speed.value} value={speed.value}>
                    {speed.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Volume Presets */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Volume Presets
              </label>
              <div className="flex space-x-1">
                {[0.25, 0.5, 0.75, 1.0].map((vol) => (
                  <button
                    key={vol}
                    onClick={() => setVolumeLevel(vol)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${Math.abs(volume - vol) < 0.1
                        ? 'bg-primary-600 text-white'
                        : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                      }`}
                    disabled={disabled}
                  >
                    {Math.round(vol * 100)}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bookmarks List */}
      {showAdvancedControls && bookmarks.length > 0 && isExpanded && (
        <div className="bg-slate-700 rounded-lg p-3">
          <h4 className="text-sm font-medium text-slate-300 mb-2">Bookmarks</h4>
          <div className="space-y-1">
            {bookmarks.map((bookmark, index) => (
              <div
                key={index}
                className="flex items-center justify-between text-sm"
              >
                <button
                  onClick={() => jumpToBookmark(bookmark)}
                  className="text-slate-300 hover:text-primary-400 transition-colors"
                  disabled={disabled}
                >
                  {formatDuration(bookmark)}
                </button>
                <button
                  onClick={() => removeBookmark(bookmark)}
                  className="text-red-400 hover:text-red-300 transition-colors text-xs"
                  disabled={disabled}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};