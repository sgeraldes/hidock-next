import { useCallback, useEffect, useRef, useState } from "react";
import { AudioRecorder } from "../services/audio-recorder";
import { showNotification } from "../components/NotificationToast";

interface AudioCaptureResult {
  isRecording: boolean;
  error: string | null;
  mimeType: string;
  pendingChunks: number;
  start: () => Promise<void>;
  stop: () => void;
  /** Stop recording and wait for all pending chunks to be ACK'd before resolving. */
  stopAndFlush: () => Promise<void>;
}

export function useAudioCapture(sessionId: string): AudioCaptureResult {
  const recorderRef = useRef<AudioRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [mimeType, setMimeType] = useState("");

  useEffect(() => {
    console.log(`[useAudioCapture] Creating new AudioRecorder for session: ${sessionId}`);
    const recorder = new AudioRecorder({
      onChunk: (blob: Blob, chunkIndex: number) => {
        console.log(`[useAudioCapture] onChunk called: chunk=${chunkIndex}, size=${blob.size}, session=${sessionId}`);
        blob.arrayBuffer().then((buffer) => {
          console.log(`[useAudioCapture] Sending chunk ${chunkIndex} (${buffer.byteLength} bytes) via IPC`);
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
        console.error(`[useAudioCapture] AudioRecorder error:`, err);
        setError(err.message);
        // Show user-facing notification for audio errors (AUD-002)
        showNotification("error", `Audio recording error: ${err.message}`);
      },
    });
    recorderRef.current = recorder;
    setMimeType(recorder.getMimeType());

    const cleanupAck = window.electronAPI.audio.onChunkAck(() => {
      recorder.acknowledgeChunk();
    });

    // Listen for chunk errors from backend (ERR-003)
    const cleanupError = window.electronAPI.audio.onChunkError?.(
      (data: { sessionId: string; chunkIndex: number; error: string }) => {
        if (data.sessionId === sessionId) {
          const errorMsg = `Audio chunk ${data.chunkIndex} failed: ${data.error}`;
          setError(errorMsg);
          showNotification("warning", errorMsg);
        }
      },
    );

    return () => {
      console.log(`[useAudioCapture] CLEANUP running for session: ${sessionId}, recorder state: ${recorder.getState()}`);
      cleanupAck();
      cleanupError?.();
      // Always dispose - this sets the disposed flag which prevents a zombie
      // recorder from starting if getUserMedia resolves after this cleanup
      // (happens with React Strict Mode double-mount)
      recorder.dispose();
    };
  }, [sessionId]);

  const start = useCallback(async () => {
    console.log('[useAudioCapture] start() called for session:', sessionId);
    const recorder = recorderRef.current;
    if (!recorder) {
      console.error('[useAudioCapture] No recorder instance!');
      return;
    }
    try {
      console.log('[useAudioCapture] Calling recorder.startRecording()...');
      setError(null);
      await recorder.startRecording();
      console.log('[useAudioCapture] Recording started successfully!');
      setIsRecording(true);
    } catch (err) {
      console.error('[useAudioCapture] Recording failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof DOMException ? err.name : "";
      setError(msg);

      if (msg.includes("System audio capture failed")) {
        const inner = msg.replace("System audio capture failed: ", "");
        if (inner.includes("NotAllowed") || inner.includes("Permission") || inner.includes("denied")) {
          showNotification(
            "error",
            "Screen recording permission denied. Grant permission in System Settings → Privacy → Screen Recording, then restart the app.",
            10000,
          );
        } else {
          showNotification(
            "error",
            "System audio capture is unavailable. This app requires system audio to record all meeting participants.",
            10000,
          );
        }
      } else if (errName === "NotAllowedError" || msg.includes("permission")) {
        showNotification(
          "error",
          "Microphone permission denied. Please enable microphone access and try again.",
          7000,
        );
      } else if (errName === "NotFoundError") {
        showNotification(
          "error",
          "No microphone found. Please connect a microphone and try again.",
        );
      } else {
        showNotification("error", `Failed to start recording: ${msg}`);
      }
    }
  }, []);

  const stop = useCallback(() => {
    console.log('[useAudioCapture] stop() called');
    const recorder = recorderRef.current;
    if (!recorder) {
      console.warn('[useAudioCapture] stop() - no recorder ref!');
      return;
    }
    console.log(`[useAudioCapture] stop() - recorder state: ${recorder.getState()}`);
    recorder.stopRecording();
    setIsRecording(false);
    setPendingChunks(0);
  }, []);

  const stopAndFlush = useCallback(async () => {
    console.log('[useAudioCapture] stopAndFlush() called');
    const recorder = recorderRef.current;
    if (!recorder) {
      console.warn('[useAudioCapture] stopAndFlush() - no recorder ref!');
      return;
    }
    console.log(`[useAudioCapture] stopAndFlush() - recorder state: ${recorder.getState()}, pending: ${recorder.getPendingChunkCount()}`);
    recorder.stopRecording();
    setIsRecording(false);
    // Wait for all chunks to be written to disk (ACK'd by main process)
    await recorder.waitForAllChunksAcked(5000);
    console.log('[useAudioCapture] stopAndFlush() - all chunks ACK\'d');
    setPendingChunks(0);
  }, []);

  return { isRecording, error, mimeType, pendingChunks, start, stop, stopAndFlush };
}
