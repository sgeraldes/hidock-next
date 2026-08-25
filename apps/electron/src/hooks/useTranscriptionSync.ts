/**
 * useTranscriptionSync - Hydrates and polls the transcription queue from the main process.
 *
 * Extracted from OperationController Phase 2+3A decomposition.
 * Real-time events drive progress; a bounded 30-second reconciliation repairs
 * missed events without transporting the terminal queue history to the renderer.
 */

import { useEffect, useRef } from 'react'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'

export const TRANSCRIPTION_RECONCILE_INTERVAL_MS = 30_000

function sqliteUtcMs(value?: string): number {
  if (!value) return Number.NaN
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`
  return new Date(normalized).getTime()
}

/**
 * A failed attempt stops being actionable once a transcript created after that
 * failure exists. An older transcript does not hide a newer re-transcription
 * failure. This defensive renderer reconciliation also works while a dev main
 * process is still serving the pre-fix queue projection.
 */
export function omitFailuresSupersededByTranscript(
  items: any[],
  transcriptsByRecordingId: Record<string, any>
): any[] {
  return items.filter((item) => {
    if (item.status !== 'failed') return true
    const transcript = transcriptsByRecordingId[item.recording_id]
    const transcriptCreatedAt = sqliteUtcMs(transcript?.created_at ?? transcript?.createdAt)
    const failedAt = sqliteUtcMs(item.completed_at ?? item.started_at ?? item.created_at)
    return !Number.isFinite(transcriptCreatedAt) || !Number.isFinite(failedAt) || transcriptCreatedAt <= failedAt
  })
}

export function useTranscriptionSync() {
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const isElectron = !!window.electronAPI?.recordings?.getTranscriptionQueue

    const reconcile = async (items: any[]) => {
      let actionable = items
      const failedRecordingIds = Array.from(new Set(
        items.filter((item) => item.status === 'failed').map((item) => item.recording_id)
      )) as string[]
      const getTranscripts = window.electronAPI?.transcripts?.getByRecordingIdsOwner
      if (failedRecordingIds.length > 0 && getTranscripts) {
        try {
          const transcripts = await getTranscripts(failedRecordingIds)
          actionable = omitFailuresSupersededByTranscript(items, transcripts)
        } catch {
          // Queue visibility must survive transcript lookup failure. The main
          // process projection will reconcile it on a later successful poll.
        }
      }
      useTranscriptionStore.getState().reconcileQueue(actionable)
    }

    // Hydrate transcription queue from database on mount
    if (isElectron) {
      window.electronAPI.recordings.getTranscriptionQueue(true).then((items: any[]) => {
        void reconcile(items)
      }).catch(e => console.error('Failed to hydrate transcription queue:', e))
    }

    // TQ-09 FIX: Subscribe to real-time transcription events instead of just polling
    const unsubscribers: (() => void)[] = []

    if (isElectron && window.electronAPI) {
      if (window.electronAPI.onTranscriptionQueued) {
        unsubscribers.push(
          window.electronAPI.onTranscriptionQueued((data) => {
            const store = useTranscriptionStore.getState()
            if (!store.queue.has(data.queueItemId)) {
              store.addToQueue(data.queueItemId, data.recordingId, data.filename || 'Unknown')
            }
          })
        )
      }

      // Listen for transcription started
      if (window.electronAPI.onTranscriptionStarted) {
        unsubscribers.push(
          window.electronAPI.onTranscriptionStarted((data) => {
            const store = useTranscriptionStore.getState()
            if (data.queueItemId) {
              if (!store.queue.has(data.queueItemId)) {
                store.addToQueue(data.queueItemId, data.recordingId, 'Unknown')
              }
              store.updateProgress(data.queueItemId, 0)
            }
          })
        )
      }

      // Listen for transcription progress
      if (window.electronAPI.onTranscriptionProgress) {
        unsubscribers.push(
          window.electronAPI.onTranscriptionProgress((data) => {
            const store = useTranscriptionStore.getState()
            if (data.queueItemId) {
              store.updateProgress(data.queueItemId, data.progress)
            }
          })
        )
      }

      // Listen for transcription completed
      if (window.electronAPI.onTranscriptionCompleted) {
        unsubscribers.push(
          window.electronAPI.onTranscriptionCompleted((data) => {
            const store = useTranscriptionStore.getState()
            if (data.queueItemId) {
              store.markCompleted(data.queueItemId, 'gemini')
            }
          })
        )
      }

      // Listen for transcription failed
      if (window.electronAPI.onTranscriptionFailed) {
        unsubscribers.push(
          window.electronAPI.onTranscriptionFailed((data) => {
            const store = useTranscriptionStore.getState()
            if (data.queueItemId) {
              if (!store.queue.has(data.queueItemId)) {
                store.addToQueue(data.queueItemId, data.recordingId, 'Unknown')
              }
              store.markFailed(data.queueItemId, data.error || 'Unknown error')
            }
          })
        )
      }

      // Listen for transcription cancelled
      if (window.electronAPI.onTranscriptionCancelled) {
        unsubscribers.push(
          window.electronAPI.onTranscriptionCancelled((data) => {
            const store = useTranscriptionStore.getState()
            // Find queue item by recordingId and remove it
            const items = Array.from(store.queue.values())
            const item = items.find((i) => i.recordingId === data.recordingId)
            if (item) {
              store.remove(item.id)
            }
          })
        )
      }

      // Listen for all transcriptions cancelled
      if (window.electronAPI.onTranscriptionAllCancelled) {
        unsubscribers.push(
          window.electronAPI.onTranscriptionAllCancelled(() => {
            const store = useTranscriptionStore.getState()
            store.clear()
          })
        )
      }
    }

    // Low-frequency safety reconciliation. Live events above remain the primary
    // path, and main returns only pending/processing/failed rows for this call.
    const transcriptionInterval = isElectron
      ? setInterval(async () => {
          try {
            if (!window.electronAPI.recordings.getTranscriptionQueue) return
            const items = await window.electronAPI.recordings.getTranscriptionQueue(true)
            if (!items) return
            await reconcile(items)
          } catch {
            // Ignore polling errors
          }
        }, TRANSCRIPTION_RECONCILE_INTERVAL_MS)
      : null

    return () => {
      if (transcriptionInterval) clearInterval(transcriptionInterval)
      // TQ-09 FIX: Cleanup event listeners
      unsubscribers.forEach((unsub) => unsub())
    }
  }, [])
}
