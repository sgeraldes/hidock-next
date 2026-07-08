import { useCallback } from 'react'
import { toast } from '@/components/ui/toaster'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'
import { cancelDownloads, cancelDownloadsComplete, requestScopedDownloads } from '@/hooks/useDownloadOrchestrator'
import type { UnifiedRecording } from '@/types/unified-recording'
import { hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import type { AppConfig } from '@/types'

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

  const validateTranscriptionConfig = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.electronAPI.config.get()
      const config = result?.success ? (result.data as AppConfig) : null
      const provider = config?.transcription?.provider || 'gemini'

      if (provider === 'gemini') {
        const apiKey = config?.transcription?.geminiApiKey
        if (!apiKey || apiKey.trim() === '') {
          toast({
            title: 'API key required',
            description: 'Please configure your Gemini API key in Settings before transcribing.',
            variant: 'error'
          })
          return false
        }
      }

      if (provider === 'local-asr') {
        const asrPath = config?.transcription?.localAsrPath
        if (!asrPath || asrPath.trim() === '') {
          toast({
            title: 'ASR path required',
            description: 'Please configure the Local ASR MCP path in Settings before transcribing.',
            variant: 'error'
          })
          return false
        }

        const diarize = config?.transcription?.localAsrDiarize !== false
        const hfToken = config?.transcription?.localAsrHfToken
        if (diarize && (!hfToken || hfToken.trim() === '')) {
          toast({
            title: 'Hugging Face token required',
            description: 'Please configure your Hugging Face token in Settings or disable speaker diarization.',
            variant: 'error'
          })
          return false
        }
      }

      return true
    } catch (e) {
      console.error('Failed to check transcription configuration:', e)
      toast({ title: 'Configuration error', description: 'Could not verify transcription configuration', variant: 'error' })
      return false
    }
  }, [])

  // ── Transcription ──────────────────────────────────────

  const queueTranscription = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) {
      toast({ title: 'Cannot transcribe', description: 'File not available locally. Download first.', variant: 'error' })
      return false
    }
    if (recording.transcriptionStatus === 'processing' || recording.transcriptionStatus === 'complete') {
      return false
    }

    if (!(await validateTranscriptionConfig())) {
      return false
    }

    try {
      await window.electronAPI.recordings.updateStatus(recording.id, 'pending')
      // Single explicit request → priority: jumps ahead of the recency-ordered backlog.
      const queueItemId = await window.electronAPI.recordings.addToQueue(recording.id, true)
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
  }, [addToQueue, validateTranscriptionConfig])

  const reprocessWithVibeVoice = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) {
      toast({ title: 'Cannot re-transcribe', description: 'File not available locally. Download first.', variant: 'error' })
      return false
    }
    if (recording.transcriptionStatus === 'processing') {
      toast({ title: 'Already in progress', description: recording.filename })
      return false
    }

    try {
      const result = await window.electronAPI.recordings.reprocessWith(recording.id, 'vibevoice')
      if (!result?.success) {
        toast({ title: 'Failed to re-transcribe', description: result?.error || 'Could not queue VibeVoice', variant: 'error' })
        return false
      }
      if (result.queueItemId) {
        addToQueue(result.queueItemId, recording.id, recording.filename)
      }
      toast({ title: 'Re-transcribing with VibeVoice', description: recording.filename })
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast({ title: 'Failed to re-transcribe', description: msg, variant: 'error' })
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

    if (!(await validateTranscriptionConfig())) {
      return 0
    }

    let queued = 0
    for (const recording of eligible) {
      try {
        await window.electronAPI.recordings.updateStatus(recording.id, 'pending')
        // Bulk: no priority flag — these sort by recording date (newest first),
        // so a single explicit request can still jump ahead of the whole batch.
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
  }, [addToQueue, validateTranscriptionConfig])

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
      // Slice 1: register the explicit scope BEFORE enqueueing so the orchestrator
      // only downloads this file (not the whole pending queue) when auto-download is off.
      requestScopedDownloads([recording.deviceFilename])
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
      // Slice 1: explicit scope = exactly the requested recordings.
      requestScopedDownloads(eligible.map((r) => r.deviceFilename))
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
      cancelDownloads()
      await window.electronAPI.downloadService.cancelAll()
      cancelDownloadsComplete()
      toast({ title: 'All downloads cancelled' })
    } catch (e) {
      cancelDownloadsComplete()
      console.error('Failed to cancel downloads:', e)
    }
  }, [])

  return {
    // Transcription
    queueTranscription,
    reprocessWithVibeVoice,
    queueBulkTranscriptions,
    cancelTranscription,
    cancelAllTranscriptions,
    // Downloads
    queueDownload,
    queueBulkDownloads,
    cancelAllDownloads
  }
}
