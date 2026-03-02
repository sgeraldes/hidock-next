/**
 * useTranscriptionEvents
 *
 * Hook to listen for transcription IPC events and update the store.
 * Handles: started, progress, completed, failed events.
 */

import { useEffect } from 'react'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'

export function useTranscriptionEvents(): void {
  const { addToQueue, updateProgress, markCompleted, markFailed } = useTranscriptionStore()

  useEffect(() => {
    // Listen for transcription started
    const unsubscribeStarted = window.electronAPI.onTranscriptionStarted((data) => {
      const { queueItemId, recordingId } = data
      if (queueItemId) {
        console.log('[Transcription] Started:', queueItemId)
      }
    })

    // Listen for progress updates
    const unsubscribeProgress = window.electronAPI.onTranscriptionProgress((data) => {
      const { queueItemId, progress, stage } = data
      console.log(`[Transcription] Progress: ${progress}% - ${stage}`)
      updateProgress(queueItemId, progress)
    })

    // Listen for completion
    const unsubscribeCompleted = window.electronAPI.onTranscriptionCompleted((data) => {
      const { queueItemId, recordingId } = data
      if (queueItemId) {
        console.log('[Transcription] Completed:', queueItemId)
        markCompleted(queueItemId, 'gemini')
      }
    })

    // Listen for failures
    const unsubscribeFailed = window.electronAPI.onTranscriptionFailed((data) => {
      const { queueItemId, recordingId, error } = data
      if (queueItemId) {
        console.log('[Transcription] Failed:', queueItemId, error)
        markFailed(queueItemId, error)
      }
    })

    // Cleanup on unmount
    return () => {
      unsubscribeStarted()
      unsubscribeProgress()
      unsubscribeCompleted()
      unsubscribeFailed()
    }
  }, [updateProgress, markCompleted, markFailed])
}
