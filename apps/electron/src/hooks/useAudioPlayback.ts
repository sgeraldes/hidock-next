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

// QA Logging helper - respects user's QA Logs toggle
function shouldLogQa(): boolean {
  const IS_PROD = import.meta.env.PROD
  if (!IS_PROD) return true // Always log in dev
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
  const isIntentionalClearRef = useRef<boolean>(false)

  // ✅ Use individual selectors to avoid subscribing to entire store
  // This prevents 60 FPS re-renders during playback (spec-002)
  const setCurrentlyPlaying = useUIStore((s) => s.setCurrentlyPlaying)
  const setPlaybackProgress = useUIStore((s) => s.setPlaybackProgress)
  const setIsPlaying = useUIStore((s) => s.setIsPlaying)
  const setWaveformData = useUIStore((s) => s.setWaveformData)

  // ---- Play Audio ----

  const playAudio = useCallback(async (recordingId: string, filePath: string) => {
    if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Playing: ${recordingId}, path: ${filePath}`)

    try {
      // Stop current playback
      if (audioRef.current) {
        audioRef.current.pause()
        isIntentionalClearRef.current = true  // Flag that we're intentionally clearing
        audioRef.current.src = ''
        setTimeout(() => { isIntentionalClearRef.current = false }, 100)  // Reset after event loop
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
        audioRef.current.addEventListener('timeupdate', () => {
          if (audioRef.current) {
            setPlaybackProgress(audioRef.current.currentTime, audioRef.current.duration)
          }
        })
        audioRef.current.addEventListener('play', () => {
          if (shouldLogQa()) console.log('[QA-MONITOR][Operation] Audio play event fired')
          setIsPlaying(true)
        })
        audioRef.current.addEventListener('pause', () => {
          setIsPlaying(false)
        })
        audioRef.current.addEventListener('ended', () => {
          setIsPlaying(false)
          setCurrentlyPlaying(null, null)
          setPlaybackProgress(0, 0)
          setWaveformData(null)
        })
        audioRef.current.addEventListener('error', (e) => {
          // Ignore error if we just intentionally cleared the src
          if (isIntentionalClearRef.current) {
            if (shouldLogQa()) console.log('[useAudioPlayback] Ignoring error from intentionally cleared src')
            return
          }

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
        })
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
    }
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
      audioRef.current.pause()
      isIntentionalClearRef.current = true  // Flag that we're intentionally clearing
      audioRef.current.src = ''
      setTimeout(() => { isIntentionalClearRef.current = false }, 100)  // Reset after event loop
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
      if (audioRef.current) {
        audioRef.current.pause()
        isIntentionalClearRef.current = true  // Flag that we're intentionally clearing
        audioRef.current.src = ''
      }
      if (audioBlobUrlRef.current) {
        URL.revokeObjectURL(audioBlobUrlRef.current)
        audioBlobUrlRef.current = null
      }
    }
  }, [])
}
