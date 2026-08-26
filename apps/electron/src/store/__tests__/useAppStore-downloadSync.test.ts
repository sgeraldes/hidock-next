/**
 * Tests for the enriched download queue mirror in useAppStore.
 *
 * `syncDownloadQueue` is the single renderer writer that mirrors the authoritative
 * main-process download-service state (status/progress/error) into the store the bell
 * popover + Operations overlay read. Cancelled rows must flash briefly, then dismiss.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from '../useAppStore'

function mainItem(over: Record<string, unknown> = {}) {
  return {
    filename: 'REC0001.WAV',
    fileSize: 1024,
    progress: 0,
    status: 'downloading' as const,
    ...over
  }
}

describe('useAppStore download queue mirror', () => {
  beforeEach(() => {
    useAppStore.getState().clearDownloadQueue()
  })

  it('mirrors active items with status/progress/size from main state', () => {
    useAppStore.getState().syncDownloadQueue([
      mainItem({ filename: 'a.wav', status: 'pending', fileSize: 200 }),
      mainItem({ filename: 'b.wav', status: 'downloading', progress: 55, fileSize: 4096 })
    ])

    const q = useAppStore.getState().downloadQueue
    expect(q.get('a.wav')).toMatchObject({ filename: 'a.wav', status: 'pending', size: 200, progress: 0 })
    expect(q.get('b.wav')).toMatchObject({ filename: 'b.wav', status: 'downloading', size: 4096, progress: 55 })
  })

  it('surfaces a transient cancelling status', () => {
    useAppStore.getState().syncDownloadQueue([mainItem({ status: 'cancelling', progress: 70 })])
    expect(useAppStore.getState().downloadQueue.get('REC0001.WAV')).toMatchObject({ status: 'cancelling' })
  })

  it('drops completed and failed items from the live list', () => {
    useAppStore.getState().syncDownloadQueue([mainItem({ status: 'downloading' })])
    useAppStore.getState().syncDownloadQueue([mainItem({ status: 'completed' })])
    expect(useAppStore.getState().downloadQueue.has('REC0001.WAV')).toBe(false)

    useAppStore.getState().syncDownloadQueue([mainItem({ filename: 'x.wav', status: 'failed' })])
    expect(useAppStore.getState().downloadQueue.has('x.wav')).toBe(false)
  })

  it('removes entries the main process no longer reports', () => {
    useAppStore.getState().syncDownloadQueue([mainItem({ filename: 'a.wav', status: 'downloading' })])
    useAppStore.getState().syncDownloadQueue([]) // main no longer reports it
    expect(useAppStore.getState().downloadQueue.has('a.wav')).toBe(false)
  })

  it('keeps the smoother renderer progress for the active item', () => {
    // Renderer drove progress to 80 via updateDownloadProgress; a throttled main emit
    // at 60 must not regress the bar.
    useAppStore.getState().addToDownloadQueue('REC0001.WAV', 'REC0001.WAV', 1024)
    useAppStore.getState().updateDownloadProgress('REC0001.WAV', 80)
    useAppStore.getState().syncDownloadQueue([mainItem({ status: 'downloading', progress: 60 })])
    expect(useAppStore.getState().downloadQueue.get('REC0001.WAV')?.progress).toBe(80)
  })

  describe('cancelled flash + dismissal', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('shows cancelled briefly, then self-dismisses; re-sync does not resurrect it', () => {
      useAppStore.getState().syncDownloadQueue([
        mainItem({ filename: 'flash.wav', status: 'cancelled', cancelReason: 'user' })
      ])
      // Visible immediately after the cancel settles.
      expect(useAppStore.getState().downloadQueue.get('flash.wav')).toMatchObject({ status: 'cancelled' })

      vi.advanceTimersByTime(4000)
      expect(useAppStore.getState().downloadQueue.has('flash.wav')).toBe(false)

      // Main still reports the terminal 'cancelled' suppression row — must NOT re-add it.
      useAppStore.getState().syncDownloadQueue([
        mainItem({ filename: 'flash.wav', status: 'cancelled', cancelReason: 'user' })
      ])
      expect(useAppStore.getState().downloadQueue.has('flash.wav')).toBe(false)
    })

    it('re-shows a re-downloaded item that becomes active again after a prior cancel', () => {
      useAppStore.getState().syncDownloadQueue([mainItem({ filename: 'again.wav', status: 'cancelled', cancelReason: 'user' })])
      vi.advanceTimersByTime(4000)
      expect(useAppStore.getState().downloadQueue.has('again.wav')).toBe(false)

      // Explicit re-download → active again → tracking cleared → visible.
      useAppStore.getState().syncDownloadQueue([mainItem({ filename: 'again.wav', status: 'downloading', progress: 5 })])
      expect(useAppStore.getState().downloadQueue.get('again.wav')).toMatchObject({ status: 'downloading' })
    })
  })
})
