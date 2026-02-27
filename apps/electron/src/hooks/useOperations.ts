import { useCallback } from 'react'
import { toast } from '@/components/ui/toaster'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'
import { cancelDownloads } from '@/hooks/useDownloadOrchestrator'
import type { UnifiedRecording } from '@/types/unified-recording'
import { hasLocalPath, isDeviceOnly } from '@/types/unified-recording'

/**
 * Centralized hook for all download and transcription operations.
 *
 * Every component that triggers downloads or transcriptions MUST use this hook
 * instead of calling IPC directly. This ensures:
 * - Consistent toast notifications
 * - Store updates for sidebar panel
 * - Error handling with user-visible messages
 * - DRY: single place to change operation behavior
 */
export function useOperations() {
  const addToQueue = useTranscriptionStore((s) => s.addToQueue)

  // ── Transcription ──────────────────────────────────────

  const queueTranscription = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) {
      toast({ title: 'Cannot transcribe', description: 'File not available locally. Download first.', variant: 'error' })
      return false
    }
    if (recording.transcriptionStatus === 'processing' || recording.transcriptionStatus === 'complete') {
      return false
    }

    // Check if API key is configured before queuing
    try {
      const apiKey = await window.electronAPI.config.getValue('transcription.geminiApiKey')
      if (!apiKey || apiKey.trim() === '') {
        toast({
          title: 'API key required',
          description: 'Please configure your Gemini API key in Settings before transcribing.',
          variant: 'error'
        })
        return false
      }
    } catch (e) {
      console.error('Failed to check API key:', e)
      toast({ title: 'Configuration error', description: 'Could not verify API key configuration', variant: 'error' })
      return false
    }

    try {
      await window.electronAPI.recordings.updateStatus(recording.id, 'pending')
      const queueItemId = await window.electronAPI.recordings.addToQueue(recording.id)
      if (!queueItemId) {
        toast({ title: 'Failed to queue transcription', description: 'Could not add to queue', variant: 'error' })
        return false
      }
      addToQueue(queueItemId, recording.id, recording.filename)
      toast({ title: 'Transcription queued', description: recording.filename })
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast({ title: 'Failed to queue transcription', description: msg, variant: 'error' })
      return false
    }
  }, [addToQueue])

  const queueBulkTranscriptions = useCallback(async (recordings: UnifiedRecording[]) => {
    const eligible = recordings.filter(
      (r) => hasLocalPath(r) && r.transcriptionStatus !== 'processing' && r.transcriptionStatus !== 'complete'
    )
    if (eligible.length === 0) {
      toast({ title: 'No recordings to transcribe', description: 'All selected recordings are already transcribed or in progress.' })
      return 0
    }

    // Check if API key is configured before queuing
    try {
      const apiKey = await window.electronAPI.config.getValue('transcription.geminiApiKey')
      if (!apiKey || apiKey.trim() === '') {
        toast({
          title: 'API key required',
          description: 'Please configure your Gemini API key in Settings before transcribing.',
          variant: 'error'
        })
        return 0
      }
    } catch (e) {
      console.error('Failed to check API key:', e)
      toast({ title: 'Configuration error', description: 'Could not verify API key configuration', variant: 'error' })
      return 0
    }

    let queued = 0
    for (const recording of eligible) {
      try {
        await window.electronAPI.recordings.updateStatus(recording.id, 'pending')
        const queueItemId = await window.electronAPI.recordings.addToQueue(recording.id)
        if (queueItemId) {
          addToQueue(queueItemId, recording.id, recording.filename)
          queued++
        }
      } catch (e) {
        console.error('Failed to queue:', recording.filename, e)
      }
    }

    toast({ title: `${queued} transcription${queued > 1 ? 's' : ''} queued`, description: 'Processing will begin shortly.' })
    return queued
  }, [addToQueue])

  const cancelTranscription = useCallback(async (recordingId: string) => {
    try {
      await window.electronAPI.recordings.cancelTranscription(recordingId)
      // TQ-03 FIX: Find and remove queue item by recordingId, not by item ID
      const store = useTranscriptionStore.getState()
      const items = Array.from(store.queue.values())
      const item = items.find((i) => i.recordingId === recordingId)
      if (item) {
        store.remove(item.id)
      }
      toast({ title: 'Transcription cancelled' })
    } catch (e) {
      console.error('Failed to cancel transcription:', e)
    }
  }, [])

  const cancelAllTranscriptions = useCallback(async () => {
    try {
      const result = await window.electronAPI.recordings.cancelAllTranscriptions()
      useTranscriptionStore.getState().clear()
      toast({ title: 'All transcriptions cancelled', description: `${result.count} items removed from queue.` })
    } catch (e) {
      console.error('Failed to cancel transcriptions:', e)
    }
  }, [])

  // ── Downloads ──────────────────────────────────────────

  const queueDownload = useCallback(async (recording: UnifiedRecording) => {
    if (!isDeviceOnly(recording)) return false

    try {
      await window.electronAPI.downloadService.queueDownloads([{
        filename: recording.deviceFilename,
        size: recording.size,
        dateCreated: recording.dateRecorded.toISOString()
      }])
      toast({ title: 'Download started', description: recording.filename })
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast({ title: 'Download failed', description: msg, variant: 'error' })
      return false
    }
  }, [])

  const queueBulkDownloads = useCallback(async (recordings: UnifiedRecording[]) => {
    const eligible = recordings.filter(isDeviceOnly)
    if (eligible.length === 0) return 0

    try {
      await window.electronAPI.downloadService.queueDownloads(
        eligible.map((r) => ({
          filename: r.deviceFilename,
          size: r.size,
          dateCreated: r.dateRecorded.toISOString()
        }))
      )
      toast({ title: `${eligible.length} download${eligible.length > 1 ? 's' : ''} queued` })
      return eligible.length
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast({ title: 'Downloads failed', description: msg, variant: 'error' })
      return 0
    }
  }, [])

  const cancelAllDownloads = useCallback(async () => {
    try {
      // DL-14: Also abort the in-progress USB transfer in the renderer
      cancelDownloads()
      await window.electronAPI.downloadService.cancelAll()
      toast({ title: 'All downloads cancelled' })
    } catch (e) {
      console.error('Failed to cancel downloads:', e)
    }
  }, [])

  return {
    // Transcription
    queueTranscription,
    queueBulkTranscriptions,
    cancelTranscription,
    cancelAllTranscriptions,
    // Downloads
    queueDownload,
    queueBulkDownloads,
    cancelAllDownloads
  }
}
