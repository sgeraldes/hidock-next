/**
 * useTranscriptionSync - Hydrates and polls the transcription queue from the main process.
 *
 * Extracted from OperationController Phase 2+3A decomposition.
 * Runs a 5-second polling interval to reconcile the renderer-side
 * useTranscriptionStore with the database queue state.
 */

import { useEffect } from 'react'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'

export function useTranscriptionSync() {
  useEffect(() => {
    const isElectron = !!window.electronAPI?.recordings?.getTranscriptionQueue

    // Hydrate transcription queue from database on mount
    if (isElectron) {
      window.electronAPI.recordings.getTranscriptionQueue().then((items: any[]) => {
        const store = useTranscriptionStore.getState()
        store.clear()
        for (const item of items) {
          if (item.status === 'pending' || item.status === 'processing') {
            store.addToQueue(item.id, item.recording_id, item.filename || 'Unknown')
            if (item.status === 'processing') {
              // TODO: Real progress should come from transcription service events.
              // Using -1 to signal indeterminate "in progress" state.
              store.updateProgress(item.id, -1)
            }
          }
        }
      }).catch(e => console.error('Failed to hydrate transcription queue:', e))
    }

    // Poll transcription queue and sync to store (5s interval)
    const transcriptionInterval = isElectron
      ? setInterval(async () => {
          try {
            if (!window.electronAPI.recordings.getTranscriptionQueue) return
            const items = await window.electronAPI.recordings.getTranscriptionQueue()
            if (!items) return

            const store = useTranscriptionStore.getState()
            const currentIds = new Set<string>()

            for (const item of items) {
              currentIds.add(item.id)

              if (item.status === 'completed') {
                if (store.queue.has(item.id)) {
                  store.markCompleted(item.id, item.provider || 'gemini')
                }
              } else if (item.status === 'failed') {
                if (store.queue.has(item.id)) {
                  store.markFailed(item.id, item.error_message || 'Unknown error')
                }
              } else if (item.status === 'processing') {
                if (!store.queue.has(item.id)) {
                  store.addToQueue(item.id, item.recording_id, item.filename || 'Unknown')
                }
                // TODO: Real progress should come from transcription service events.
                // Using -1 to signal indeterminate "in progress" state.
                store.updateProgress(item.id, -1)
              } else if (item.status === 'pending') {
                if (!store.queue.has(item.id)) {
                  store.addToQueue(item.id, item.recording_id, item.filename || 'Unknown')
                }
              }
            }

            // Remove items from store that are no longer in the DB queue
            store.queue.forEach((_, id) => {
              if (!currentIds.has(id)) {
                store.remove(id)
              }
            })
          } catch {
            // Ignore polling errors
          }
        }, 5000)
      : null

    return () => {
      if (transcriptionInterval) clearInterval(transcriptionInterval)
    }
  }, [])
}
