/**
 * useAudioPlayback - Manages audio playback, waveform generation, and exposes controls.
 *
 * Extracted from OperationController Phase 2+3A decomposition.
 * Owns the singleton HTMLAudioElement, Blob URL lifecycle, waveform abort controller,
 * and the window.__audioControls global registration.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useUIStore } from '@/store/useUIStore'
import { toast } from '@/components/ui/toaster'
import { parseError, getErrorMessage } from '@/features/library/utils/errorHandling'
import { generateWaveformData, decodeAudioData, getAudioMimeType } from '@/utils/audioUtils'

function shouldLogQa(): boolean {
  try {
    return useUIStore.getState().qaLogsEnabled
  } catch {
    return false
  }
}

export function useAudioPlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioBlobUrlRef = useRef<string | null>(null)
  const waveformAbortControllerRef = useRef<AbortController | null>(null)
  const playbackLockRef = useRef<Promise<void> | null>(null)

  const {
    setCurrentlyPlaying,
    setPlaybackProgress,
    setIsPlaying,
    setWaveformData
  } = useUIStore()

  // ---- Play Audio ----

  const playAudio = useCallback(async (recordingId: string, filePath: string) => {
    if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Playing: ${recordingId}, path: ${filePath}`)

    // Wait for any pending operation to complete to prevent race conditions
    if (playbackLockRef.current) {
      if (shouldLogQa()) console.log('[useAudioPlayback] Waiting for previous playback operation to complete')
      await playbackLockRef.current
    }

    // Create new lock for this operation
    playbackLockRef.current = (async () => {
      try {
        // Stop current playback
        if (audioRef.current) {
          // Clean up event listeners before stopping
          if ((audioRef.current as any)._eventCleanup) {
            ;(audioRef.current as any)._eventCleanup()
          }
          audioRef.current.pause()
          audioRef.current.src = ''
          audioRef.current = null // Clear the ref to allow recreation with fresh listeners
        }
        // Revoke previous Blob URL to prevent memory leaks
        if (audioBlobUrlRef.current) {
          URL.revokeObjectURL(audioBlobUrlRef.current)
          audioBlobUrlRef.current = null
        }
        setIsPlaying(false)
        setPlaybackProgress(0, 0)

        // Set currently playing immediately to show loading state in UI
        setCurrentlyPlaying(recordingId, filePath)

        // Load audio file via IPC
        if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Reading audio file: ${filePath}`)
        const response = await window.electronAPI.storage.readRecording(filePath)
        if (!response.success || !response.data) {
          const errorMsg = response.error || 'Failed to load audio file'
          console.error(`[useAudioPlayback] readRecording failed:`, errorMsg)
          toast({ title: 'Error', description: errorMsg, variant: 'error' })
          setCurrentlyPlaying(null, null)
          return
        }
        const base64 = response.data
        if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Audio data loaded: ${(base64.length / 1024).toFixed(1)}KB base64`)

        // Create audio element if needed
        if (!audioRef.current) {
          if (shouldLogQa()) console.log('[useAudioPlayback] Creating new Audio element')
          audioRef.current = new Audio()

          // Define event handlers as named functions so they can be properly removed
          const handleTimeUpdate = () => {
            if (audioRef.current) {
              setPlaybackProgress(audioRef.current.currentTime, audioRef.current.duration)
            }
          }

          const handlePlay = () => {
            if (shouldLogQa()) console.log('[QA-MONITOR][Operation] Audio play event fired')
            setIsPlaying(true)
          }

          const handlePause = () => {
            setIsPlaying(false)
          }

          const handleEnded = () => {
            setIsPlaying(false)
            setCurrentlyPlaying(null, null)
            setPlaybackProgress(0, 0)
            setWaveformData(null)
          }

          const handleError = (e: ErrorEvent) => {
            const mediaError = audioRef.current?.error
            console.error('[useAudioPlayback] Audio element error:', {
              code: mediaError?.code,
              message: mediaError?.message,
              event: e
            })
            const libraryError = parseError(e, 'audio playback')
            toast({
              title: 'Playback error',
              description: getErrorMessage(libraryError.type),
              variant: 'error'
            })
            setIsPlaying(false)
            setCurrentlyPlaying(null, null)
            setWaveformData(null)
          }

          // Add event listeners
          audioRef.current.addEventListener('timeupdate', handleTimeUpdate)
          audioRef.current.addEventListener('play', handlePlay)
          audioRef.current.addEventListener('pause', handlePause)
          audioRef.current.addEventListener('ended', handleEnded)
          audioRef.current.addEventListener('error', handleError)

          // Store cleanup functions for removal
          // We use a custom property to track the handlers for cleanup
          ;(audioRef.current as any)._eventCleanup = () => {
            const audio = audioRef.current
            if (audio) {
              audio.removeEventListener('timeupdate', handleTimeUpdate)
              audio.removeEventListener('play', handlePlay)
              audio.removeEventListener('pause', handlePause)
              audio.removeEventListener('ended', handleEnded)
              audio.removeEventListener('error', handleError)
            }
          }
        }

        const mimeType = getAudioMimeType(filePath)

        // Generate waveform data for visualization (skip if already loaded)
        const { waveformLoadedForId } = useUIStore.getState()
        if (waveformLoadedForId !== recordingId) {
          try {
            const audioBuffer = await decodeAudioData(base64, mimeType)
            const waveformData = await generateWaveformData(audioBuffer, 1000)
            setWaveformData(waveformData)
            useUIStore.getState().setWaveformLoadedFor(recordingId)
          } catch (waveformError) {
            console.warn('[useAudioPlayback] Failed to generate waveform:', waveformError)
            setWaveformData(null)
            useUIStore.getState().setWaveformLoadingError(recordingId, 'Failed to generate waveform')
          }
        } else {
          if (shouldLogQa()) console.log('[useAudioPlayback] Skipping waveform generation - already loaded')
        }

        // Convert base64 to Blob URL (more reliable than data URI for larger files)
        const binaryData = atob(base64)
        const uint8Array = new Uint8Array(binaryData.length)
        for (let i = 0; i < binaryData.length; i++) {
          uint8Array[i] = binaryData.charCodeAt(i)
        }
        const blob = new Blob([uint8Array], { type: mimeType })
        audioBlobUrlRef.current = URL.createObjectURL(blob)

        if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Setting audio src (Blob URL), mime: ${mimeType}, size: ${blob.size} bytes`)
        audioRef.current.src = audioBlobUrlRef.current
        if (shouldLogQa()) console.log('[QA-MONITOR][Operation] Calling audio.play()')
        await audioRef.current.play()
        if (shouldLogQa()) console.log('[QA-MONITOR][Operation] audio.play() resolved successfully')
      } catch (error) {
        const libraryError = parseError(error, 'audio playback')
        console.error('[useAudioPlayback] Play error:', error)
        toast({
          title: 'Playback error',
          description: getErrorMessage(libraryError.type),
          variant: 'error'
        })
        setIsPlaying(false)
        setCurrentlyPlaying(null, null)
        setWaveformData(null)
      } finally {
        // Always release the lock when done
        playbackLockRef.current = null
      }
    })()

    return playbackLockRef.current
  }, [setCurrentlyPlaying, setPlaybackProgress, setIsPlaying, setWaveformData])

  // ---- Waveform-Only Load ----

  const loadWaveformOnly = useCallback(async (recordingId: string, filePath: string) => {
    if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Loading waveform only: ${recordingId}`)

    // Cancel any in-flight waveform loading
    if (waveformAbortControllerRef.current) {
      waveformAbortControllerRef.current.abort()
    }

    waveformAbortControllerRef.current = new AbortController()
    const signal = waveformAbortControllerRef.current.signal

    const { setWaveformLoading, setWaveformLoadingError, setWaveformLoadedFor, setWaveformData } = useUIStore.getState()
    setWaveformLoading(recordingId)

    try {
      if (signal.aborted) {
        if (shouldLogQa()) console.log('[useAudioPlayback] Waveform load aborted (early)')
        return
      }

      const response = await window.electronAPI.storage.readRecording(filePath)

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to read audio file')
      }

      const base64 = response.data
      const fileSizeBytes = Math.ceil((base64.length * 3) / 4)

      const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
      if (fileSizeBytes > MAX_FILE_SIZE) {
        throw new Error(`File too large (${Math.round(fileSizeBytes / (1024 * 1024))}MB). Maximum size is 100MB.`)
      }

      if (signal.aborted) return

      const mimeType = getAudioMimeType(filePath)
      const audioBuffer = await decodeAudioData(base64, mimeType)

      if (signal.aborted) return

      const waveformData = await generateWaveformData(audioBuffer, 1000)

      if (signal.aborted) return

      setWaveformData(waveformData)
      setWaveformLoadedFor(recordingId)

      if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Waveform loaded successfully: ${recordingId}`)
    } catch (error) {
      if (signal.aborted) return

      const libraryError = parseError(error, 'waveform generation')
      console.error('[useAudioPlayback] Waveform load error:', error)

      setWaveformLoadingError(recordingId, getErrorMessage(libraryError.type))
      setWaveformData(null)
    }
  }, [])

  // ---- Simple Controls ----

  const pauseAudio = useCallback(() => {
    if (audioRef.current) audioRef.current.pause()
  }, [])

  const resumeAudio = useCallback(() => {
    if (audioRef.current) audioRef.current.play()
  }, [])

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      // Clean up event listeners when stopping
      if ((audioRef.current as any)._eventCleanup) {
        ;(audioRef.current as any)._eventCleanup()
      }
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null // Clear the ref to allow recreation with fresh listeners
    }
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current)
      audioBlobUrlRef.current = null
    }
    setIsPlaying(false)
    setCurrentlyPlaying(null, null)
    setPlaybackProgress(0, 0)
    setWaveformData(null)
  }, [setCurrentlyPlaying, setIsPlaying, setPlaybackProgress, setWaveformData])

  const seekAudio = useCallback((time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time
  }, [])

  const setPlaybackRate = useCallback((rate: number) => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [])

  // ---- Expose controls globally via window.__audioControls ----

  useEffect(() => {
    window.__audioControls = {
      play: playAudio,
      pause: pauseAudio,
      resume: resumeAudio,
      stop: stopAudio,
      seek: seekAudio,
      setPlaybackRate,
      loadWaveformOnly
    }

    return () => {
      delete window.__audioControls
    }
  }, [playAudio, pauseAudio, resumeAudio, stopAudio, seekAudio, setPlaybackRate, loadWaveformOnly])

  // ---- Cleanup on unmount ----

  useEffect(() => {
    return () => {
      // Clean up audio element
      if (audioRef.current) {
        // Remove event listeners first to prevent memory leaks
        if ((audioRef.current as any)._eventCleanup) {
          ;(audioRef.current as any)._eventCleanup()
        }
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      // Clean up blob URL
      if (audioBlobUrlRef.current) {
        URL.revokeObjectURL(audioBlobUrlRef.current)
        audioBlobUrlRef.current = null
      }
      // Abort any in-flight waveform generation
      if (waveformAbortControllerRef.current) {
        waveformAbortControllerRef.current.abort()
      }
    }
  }, [])
}
