/**
 * @vitest-environment jsdom
 *
 * Regression: the per-file DL button could be clicked repeatedly and fire the
 * same download concurrently (which errored). Once a download starts, the
 * recording is added to the global downloadQueue, which hides the DL button and
 * shows progress; a synchronous guard also blocks a re-fire before the re-render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeviceFileList } from '../DeviceFileList'
import { useAppStore } from '@/store/useAppStore'
import type { DeviceOnlyRecording } from '@/types/unified-recording'

// Default: a download that never settles, so the "in progress" state holds.
const downloadRecordingToFile = vi.fn(() => new Promise<boolean>(() => {}))

vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: () => ({
    downloadRecordingToFile,
    deleteRecording: vi.fn(),
  }),
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const rec: DeviceOnlyRecording = {
  id: 'rec-1',
  filename: 'test.hda',
  size: 1000,
  duration: 60,
  dateRecorded: new Date('2026-06-24T10:00:00Z'),
  transcriptionStatus: 'none',
  location: 'device-only',
  deviceFilename: 'test.hda',
  syncStatus: 'not-synced',
}

describe('DeviceFileList — DL button download guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ downloadQueue: new Map() })
  })

  it('fires the download once and hides the DL button while in progress', () => {
    render(<DeviceFileList recordings={[rec]} syncedFilenames={new Set()} onRefresh={vi.fn()} onRecordingsRefresh={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'DL' }))

    // Exactly one download started, and the button is gone (cannot be re-fired)
    expect(downloadRecordingToFile).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'DL' })).toBeNull()
    // Recording is marked downloading in the global store
    expect(useAppStore.getState().downloadQueue.has('rec-1')).toBe(true)
  })

  it('re-enables the DL button after a failed download', async () => {
    downloadRecordingToFile.mockResolvedValueOnce(false)
    render(<DeviceFileList recordings={[rec]} syncedFilenames={new Set()} onRefresh={vi.fn()} onRecordingsRefresh={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'DL' }))

    // After the failed download settles, the recording leaves the queue and the
    // DL button comes back.
    await waitFor(() => {
      expect(useAppStore.getState().downloadQueue.has('rec-1')).toBe(false)
    })
    expect(screen.getByRole('button', { name: 'DL' })).toBeInTheDocument()
  })
})
