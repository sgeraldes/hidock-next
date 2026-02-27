import { useCallback, useEffect, useRef, useState } from "react";
import { AudioRecorder, AudioRecorderState } from "../services/audio-recorder";

interface AudioCaptureResult {
  isRecording: boolean;
  error: string | null;
  mimeType: string;
  pendingChunks: number;
  start: () => Promise<void>;
  stop: () => void;
}

export function useAudioCapture(sessionId: string): AudioCaptureResult {
  const recorderRef = useRef<AudioRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [mimeType, setMimeType] = useState("");

  useEffect(() => {
    const recorder = new AudioRecorder({
      onChunk: (blob: Blob, chunkIndex: number) => {
        blob.arrayBuffer().then((buffer) => {
          window.electronAPI.audio.sendChunk(
            buffer,
            sessionId,
            chunkIndex,
            recorder.getMimeType(),
          );
          setPendingChunks(recorder.getPendingChunkCount());
        });
      },
      onError: (err: Error) => {
        setError(err.message);
      },
    });
    recorderRef.current = recorder;
    setMimeType(recorder.getMimeType());

    const cleanupAck = window.electronAPI.audio.onChunkAck(() => {
      recorder.acknowledgeChunk();
    });

    return () => {
      cleanupAck();
      if (recorder.getState() !== AudioRecorderState.Idle) {
        recorder.stopRecording();
      }
    };
  }, [sessionId]);

  const start = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      setError(null);
      await recorder.startRecording();
      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.stopRecording();
    setIsRecording(false);
    setPendingChunks(0);
  }, []);

  return { isRecording, error, mimeType, pendingChunks, start, stop };
}
