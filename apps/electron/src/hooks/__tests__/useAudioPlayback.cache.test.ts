/**
 * useAudioPlayback — H5 disk-cache behaviour.
 *
 * Verifies that waveform peaks load from the disk cache WITHOUT recomputing
 * (no decode, no read, no "loading" state) on a cache hit, and that a cache miss
 * computes the peaks and persists them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAudioPlayback } from '../useAudioPlayback'
import { useUIStore } from '@/store/useUIStore'

const generateWaveformData = vi.fn()
const decodeAudioData = vi.fn()

vi.mock('@/utils/audioUtils', () => ({
  generateWaveformData: (...a: unknown[]) => generateWaveformData(...a),
  decodeAudioData: (...a: unknown[]) => decodeAudioData(...a),
  getAudioMimeType: () => 'audio/mpeg',
  formatTimestamp: (s: number) => String(s)
}))

const getCache = vi.fn()
const setCache = vi.fn().mockResolvedValue(true)
const readRecording = vi.fn()
const updateDuration = vi.fn().mockResolvedValue({ success: true })

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({
    playbackWaveformData: null,
    waveformLoadingId: null,
    waveformLoadedForId: null,
    waveformLoadingError: null
  } as never)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    waveform: { getCache, setCache, clearCache: vi.fn() },
    storage: { readRecording },
    recordings: { updateDuration }
  }
})

describe('useAudioPlayback — H5 disk cache', () => {
  it('loads peaks from cache WITHOUT recomputing (no decode, no read, no loading state)', async () => {
    getCache.mockResolvedValue({
      version: 1,
      recordingId: 'rec-1',
      peaks: [0.1, 0.5, 0.9],
      sampleCount: 3,
      duration: 10,
      fileSize: 100,
      createdAt: 'now'
    })

    renderHook(() => useAudioPlayback())
    await window.__audioControls!.loadWaveformOnly('rec-1', '/x/rec-1.mp3')

    // Instant cache path — no compute, no file read.
    expect(getCache).toHaveBeenCalledWith('rec-1')
    expect(decodeAudioData).not.toHaveBeenCalled()
    expect(generateWaveformData).not.toHaveBeenCalled()
    expect(readRecording).not.toHaveBeenCalled()

    // Data applied, loaded flag set, and NO lingering loading overlay state.
    const state = useUIStore.getState()
    expect(state.playbackWaveformData).toBeInstanceOf(Float32Array)
    const peaks = Array.from(state.playbackWaveformData!)
    expect(peaks).toHaveLength(3)
    ;[0.1, 0.5, 0.9].forEach((v, i) => expect(peaks[i]).toBeCloseTo(v, 5))
    expect(state.waveformLoadedForId).toBe('rec-1')
    expect(state.waveformLoadingId).toBeNull()
    // Duration backfilled from the cache (no re-decode needed).
    expect(state.playbackDuration).toBe(10)
  })

  it('computes and persists peaks on a cache miss', async () => {
    getCache.mockResolvedValue(null)
    readRecording.mockResolvedValue({ success: true, data: btoa('audio-bytes') })
    decodeAudioData.mockResolvedValue({ duration: 42 })
    generateWaveformData.mockResolvedValue(new Float32Array([0.2, 0.4]))

    renderHook(() => useAudioPlayback())
    await window.__audioControls!.loadWaveformOnly('rec-2', '/x/rec-2.mp3')

    expect(readRecording).toHaveBeenCalledWith('/x/rec-2.mp3')
    expect(generateWaveformData).toHaveBeenCalled()
    // Peaks persisted to the disk cache for next time.
    expect(setCache).toHaveBeenCalledTimes(1)
    expect(setCache.mock.calls[0][0]).toBe('rec-2')
    expect(Array.isArray(setCache.mock.calls[0][1])).toBe(true)

    expect(useUIStore.getState().waveformLoadedForId).toBe('rec-2')
  })
})
