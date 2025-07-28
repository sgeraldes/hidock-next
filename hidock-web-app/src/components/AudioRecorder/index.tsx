import type { AudioData } from '@/types';
import { formatDuration } from '@/utils/formatters';
import {
  Download,
  Mic,
  Pause,
  Play,
  Square,
  Trash2
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface RecordingQuality {
  sampleRate: number;
  bitRate: number;
  channels: number;
  label: string;
}

export interface AudioRecorderProps {
  onRecordingComplete: (audioData: AudioData) => void;
  onError: (error: string) => void;
  disabled?: boolean;
  className?: string;
  showAdvancedControls?: boolean;
  showVisualization?: boolean;
  maxDuration?: number; // in seconds
  autoSave?: boolean;
  quality?: RecordingQuality;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onRecordingComplete,
  onError,
  disabled = false,
  className = '',
  showAdvancedControls = false,
  showVisualization = false,
  maxDuration = 3600, // 1 hour default
  autoSave = false,
  quality = { sampleRate: 44100, bitRate: 128000, channels: 2, label: 'High Quality' }
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState(quality);
  const [recordings, setRecordings] = useState<Array<{ id: string, blob: Blob, duration: number, timestamp: Date }>>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const animationRef = useRef<number>();

  const qualityPresets: RecordingQuality[] = [
    { sampleRate: 8000, bitRate: 32000, channels: 1, label: 'Phone Quality' },
    { sampleRate: 22050, bitRate: 64000, channels: 1, label: 'Voice' },
    { sampleRate: 44100, bitRate: 128000, channels: 2, label: 'High Quality' },
    { sampleRate: 48000, bitRate: 192000, channels: 2, label: 'Studio Quality' }
  ];

  // Cleanup function
  // Audio level monitoring
  const startMonitoring = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: selectedQuality.sampleRate,
        }
      });

      streamRef.current = stream;

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      source.connect(analyserRef.current);

      setIsMonitoring(true);

      const updateLevel = () => {
        if (!analyserRef.current || !isMonitoring) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        setInputLevel(average / 255);

        if (showVisualization) {
          drawVisualization(dataArray);
        }

        animationRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();

    } catch (error) {
      console.error('Error starting monitoring:', error);
      onError('Failed to access microphone for monitoring');
    }
  }, [selectedQuality.sampleRate, isMonitoring, showVisualization, onError]);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setInputLevel(0);
  }, []);

  // Visualization
  const drawVisualization = useCallback((dataArray: Uint8Array) => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

      const hue = (i / dataArray.length) * 360;
      ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

      x += barWidth + 1;
    }
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    stopMonitoring();

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  }, [audioUrl, stopMonitoring]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        }
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);

        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        cleanup();
      };

      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setRecordingTime(0);
      startTimer();

    } catch (error) {
      console.error('Error starting recording:', error);
      onError('Failed to start recording. Please check microphone permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      stopTimer();
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
        startTimer();
        setIsPaused(false);
      } else {
        mediaRecorderRef.current.pause();
        stopTimer();
        setIsPaused(true);
      }
    }
  };

  const playRecording = () => {
    const audio = audioRef.current;
    if (audio && audioUrl) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        audio.play();
        setIsPlaying(true);
      }
    }
  };

  const deleteRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    setIsPlaying(false);
  };

  const saveRecording = async () => {
    if (!audioBlob) return;

    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        const base64Data = base64.split(',')[1];

        const audioData: AudioData = {
          fileName: `recording_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`,
          base64: base64Data,
          mimeType: 'audio/webm',
          size: audioBlob.size,
          duration: recordingTime,
        };

        onRecordingComplete(audioData);
        deleteRecording(); // Clean up after saving
      };

      reader.readAsDataURL(audioBlob);
    } catch (error) {
      onError('Failed to save recording');
    }
  };

  const downloadRecording = () => {
    if (audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `recording_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Recording Controls */}
      <div className="bg-slate-800 rounded-lg p-6">
        <div className="text-center space-y-4">
          {/* Recording Status */}
          <div className="space-y-2">
            <div className="flex items-center justify-center space-x-2">
              {isRecording && (
                <div className={`w-3 h-3 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
              )}
              <h3 className="text-lg font-semibold text-slate-100">
                {isRecording
                  ? (isPaused ? 'Recording Paused' : 'Recording...')
                  : (audioBlob ? 'Recording Complete' : 'Ready to Record')
                }
              </h3>
            </div>

            {/* Timer */}
            <div className="text-2xl font-mono text-primary-400">
              {formatDuration(recordingTime)}
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-center space-x-3">
            {!isRecording && !audioBlob && (
              <button
                onClick={startRecording}
                disabled={disabled}
                className="btn-primary flex items-center space-x-2 px-6 py-3"
              >
                <Mic className="w-5 h-5" />
                <span>Start Recording</span>
              </button>
            )}

            {isRecording && (
              <>
                <button
                  onClick={pauseRecording}
                  className="btn-secondary flex items-center space-x-2"
                >
                  {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  <span>{isPaused ? 'Resume' : 'Pause'}</span>
                </button>

                <button
                  onClick={stopRecording}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center space-x-2"
                >
                  <Square className="w-4 h-4" />
                  <span>Stop</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Playback Controls */}
      {audioBlob && audioUrl && (
        <div className="bg-slate-800 rounded-lg p-4">
          <audio
            ref={audioRef}
            src={audioUrl}
            onEnded={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={playRecording}
                className="p-2 bg-primary-600 hover:bg-primary-700 rounded-lg"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 text-white" />
                ) : (
                  <Play className="w-4 h-4 text-white" />
                )}
              </button>

              <span className="text-slate-300 text-sm">
                Duration: {formatDuration(recordingTime)}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={downloadRecording}
                className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-200"
                title="Download Recording"
              >
                <Download className="w-4 h-4" />
              </button>

              <button
                onClick={saveRecording}
                className="btn-primary text-sm px-3 py-1"
              >
                Use Recording
              </button>

              <button
                onClick={deleteRecording}
                className="p-2 hover:bg-slate-700 rounded-lg text-red-400 hover:text-red-300"
                title="Delete Recording"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recording Tips */}
      <div className="text-sm text-slate-400 bg-slate-800/50 rounded-lg p-3">
        <p className="font-medium mb-1">Recording Tips:</p>
        <ul className="space-y-1 text-xs">
          <li>• Ensure your microphone is working and permissions are granted</li>
          <li>• Speak clearly and avoid background noise</li>
          <li>• Keep the device close to the speaker for best quality</li>
          <li>• You can pause and resume recording as needed</li>
        </ul>
      </div>
    </div>
  );
};