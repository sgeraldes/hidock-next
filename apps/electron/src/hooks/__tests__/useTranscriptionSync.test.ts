import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRANSCRIPTION_RECONCILE_INTERVAL_MS,
  omitFailuresSupersededByTranscript,
  useTranscriptionSync
} from '../useTranscriptionSync'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'

describe('useTranscriptionSync', () => {
  const getTranscriptionQueue = vi.fn()
  let queuedCallback: ((data: { queueItemId: string; recordingId: string; filename?: string }) => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    useTranscriptionStore.getState().clear()
    getTranscriptionQueue.mockReset().mockResolvedValue([
      { id: 'q-1', recording_id: 'rec-1', filename: 'one.hda', status: 'pending', progress: 0 }
    ])
    queuedCallback = undefined
    ;(window as any).electronAPI = {
      recordings: { getTranscriptionQueue },
      onTranscriptionQueued: vi.fn((callback) => {
        queuedCallback = callback
        return vi.fn()
      })
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hydrates and reconciles only actionable rows at the reduced cadence', async () => {
    const { unmount } = renderHook(() => useTranscriptionSync())

    await act(async () => {
      await Promise.resolve()
    })
    expect(getTranscriptionQueue).toHaveBeenCalledWith(true)
    expect(getTranscriptionQueue).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(getTranscriptionQueue).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSCRIPTION_RECONCILE_INTERVAL_MS - 5_000)
    })
    expect(getTranscriptionQueue).toHaveBeenCalledTimes(2)
    expect(useTranscriptionStore.getState().queue.size).toBe(1)
    unmount()
  })

  it('projects an automatic enqueue immediately without waiting for the safety poll', async () => {
    getTranscriptionQueue.mockResolvedValue([])
    const { unmount } = renderHook(() => useTranscriptionSync())
    await act(async () => {
      await Promise.resolve()
      queuedCallback?.({ queueItemId: 'q-auto', recordingId: 'rec-auto', filename: 'auto.hda' })
    })

    expect(useTranscriptionStore.getState().queue.get('q-auto')).toMatchObject({
      recordingId: 'rec-auto',
      filename: 'auto.hda',
      status: 'pending'
    })
    expect(getTranscriptionQueue).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('automatically removes a failure superseded by a later successful transcript', async () => {
    getTranscriptionQueue.mockResolvedValue([{
      id: 'q-failed',
      recording_id: 'rec-1',
      filename: 'one.hda',
      status: 'failed',
      completed_at: '2026-08-21 19:35:03'
    }])
    ;(window as any).electronAPI.transcripts = {
      getByRecordingIdsOwner: vi.fn().mockResolvedValue({
        'rec-1': { id: 'tx-1', created_at: '2026-08-22 01:30:33' }
      })
    }

    const { unmount } = renderHook(() => useTranscriptionSync())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useTranscriptionStore.getState().queue.size).toBe(0)
    unmount()
  })

  it('does not let an older transcript hide a newer failed re-transcription', () => {
    const items = [{
      id: 'q-failed',
      recording_id: 'rec-1',
      status: 'failed',
      completed_at: '2026-08-23 19:35:03'
    }]

    expect(omitFailuresSupersededByTranscript(items, {
      'rec-1': { created_at: '2026-08-22 01:30:33' }
    })).toEqual(items)
  })
})
