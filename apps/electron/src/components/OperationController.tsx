/**
 * OperationController - Unified background operations manager
 *
 * This component lives in Layout and handles ALL operations that should
 * persist across page navigation. It composes focused hooks:
 * - useAudioPlayback: Audio element lifecycle, waveform, global controls
 * - useDownloadOrchestrator: USB file downloads, queue management, stall detection
 * - useDeviceSubscriptions: Device state/status subscriptions, auto-sync
 * - useTranscriptionSync: Transcription queue hydration and polling
 *
 * Pages should ONLY display state and dispatch actions - they should never
 * own long-running operations or hold critical state.
 */

import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useConfigStore } from '@/store/domain/useConfigStore'
import { useAudioPlayback } from '@/hooks/useAudioPlayback'
import { useDownloadOrchestrator } from '@/hooks/useDownloadOrchestrator'
import { useDeviceSubscriptions } from '@/hooks/useDeviceSubscriptions'
import { useTranscriptionSync } from '@/hooks/useTranscriptionSync'
import { shouldLogQa } from '@/services/qa-monitor'

export function OperationController() {
  // Compose focused hooks for each responsibility
  useAudioPlayback()
  useDownloadOrchestrator()
  useDeviceSubscriptions()
  useTranscriptionSync()

  // Calendar sync - thin enough to remain inline
  const { loadMeetings } = useAppStore()
  const config = useConfigStore((s) => s.config)

  useEffect(() => {
    if (config?.calendar?.icsUrl && config?.calendar?.syncEnabled) {
      loadMeetings()
    }
  }, [config?.calendar?.icsUrl, config?.calendar?.syncEnabled, loadMeetings])

  useEffect(() => {
    if (shouldLogQa()) console.log('[QA-MONITOR][OperationController] Mounted (decomposed)')
    return () => {
      if (shouldLogQa()) console.log('[QA-MONITOR][OperationController] Unmounting')
    }
  }, [])

  // This component renders nothing - purely side effects
  return null
}

// =============================================================================
// Hook for accessing audio controls from any component
// =============================================================================

export const useAudioControls = () => {
  // B-LIB-002: Memoize the controls object to prevent stale closures
  // and unnecessary re-renders in consuming components. The functions
  // delegate to window.__audioControls at call time, so they always
  // reference the latest implementation.
  return useMemo(() => ({
    play: (recordingId: string, filePath: string) => {
      window.__audioControls?.play(recordingId, filePath)
    },
    pause: () => {
      window.__audioControls?.pause()
    },
    resume: () => {
      window.__audioControls?.resume()
    },
    stop: () => {
      window.__audioControls?.stop()
    },
    seek: (time: number) => {
      window.__audioControls?.seek(time)
    },
    setPlaybackRate: (rate: number) => {
      window.__audioControls?.setPlaybackRate(rate)
    },
    loadWaveformOnly: (recordingId: string, filePath: string) => {
      window.__audioControls?.loadWaveformOnly(recordingId, filePath)
    }
  }), [])
}
