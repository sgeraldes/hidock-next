import { useEffect, useRef, useState } from 'react'

export interface UseAudioCaptureReturn {
  isCapturing: boolean
  error: string | null
}

/**
 * useAudioCapture subscribes to main-process start/stop events and manages
 * a MediaRecorder lifecycle that sends 5-second audio chunks to the main
 * process via IPC.
 *
 * Mount this hook once at the App root so it is always active.
 */
export function useAudioCapture(): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunkIndexRef = useRef(0)

  useEffect(() => {
    // Graceful degradation: if the Electron audio bridge is not available (e.g.
    // running in a plain browser) do nothing.
    if (!window.electronAPI?.audio) return

    const stopCapture = (): void => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      recorderRef.current = null
      chunkIndexRef.current = 0
      setIsCapturing(false)
    }

    const startCapture = async (_data: { sessionId: string }): Promise<void> => {
      // Reset any previous error
      setError(null)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        chunkIndexRef.current = 0

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'

        const recorder = new MediaRecorder(stream, { mimeType })
        recorderRef.current = recorder

        recorder.ondataavailable = async (event: BlobEvent): Promise<void> => {
          if (event.data.size === 0) return
          if (!window.electronAPI?.audio) return

          try {
            const arrayBuffer = await event.data.arrayBuffer()
            const uint8 = new Uint8Array(arrayBuffer)
            const index = chunkIndexRef.current++
            await window.electronAPI.audio.sendChunk(uint8, Date.now(), index)
          } catch (err) {
            console.error('[useAudioCapture] Failed to send chunk:', err)
          }
        }

        recorder.onerror = (event: Event): void => {
          const err = (event as Event & { error?: DOMException }).error
          const msg = err?.message ?? 'MediaRecorder error'
          console.error('[useAudioCapture] MediaRecorder error:', msg)
          setError(msg)
          stopCapture()
        }

        recorder.onstop = (): void => {
          // Clean up stream tracks when recorder stops
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop())
            streamRef.current = null
          }
          setIsCapturing(false)
        }

        // Start recording with 5-second timeslices
        recorder.start(5000)
        setIsCapturing(true)
      } catch (err) {
        const domError = err as DOMException
        if (domError.name === 'NotAllowedError') {
          setError('Microphone permission denied. Please grant microphone access.')
        } else if (domError.name === 'NotFoundError') {
          setError('No microphone found. Please connect a microphone.')
        } else {
          setError(domError.message ?? 'Failed to start audio capture')
        }
        console.error('[useAudioCapture] getUserMedia error:', err)
      }
    }

    const unsubStart = window.electronAPI.audio.onStartCapture((data) => {
      startCapture(data).catch((err) => {
        console.error('[useAudioCapture] startCapture rejected:', err)
      })
    })

    const unsubStop = window.electronAPI.audio.onStopCapture(() => {
      stopCapture()
    })

    return () => {
      unsubStart()
      unsubStop()
      stopCapture()
    }
  }, [])

  return { isCapturing, error }
}
