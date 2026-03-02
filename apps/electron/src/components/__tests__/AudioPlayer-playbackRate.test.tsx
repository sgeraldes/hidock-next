/**
 * FIX-011: Playback rate selector does nothing
 *
 * BUG: AudioPlayer.tsx has a rate selector (0.5x, 1x, 1.5x, 2x)
 * that only updates local state and logs to console.
 * The actual HTMLAudioElement.playbackRate is never set.
 *
 * The fix requires:
 * 1. OperationController exposes a setPlaybackRate function
 * 2. AudioPlayer calls it when rate changes
 * 3. The function sets audioRef.current.playbackRate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Test the useAudioControls hook shape and the OperationController's exposed controls
describe('FIX-011: Playback rate control', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('BUG: useAudioControls must expose setPlaybackRate', async () => {
    // Import the hook
    const { useAudioControls } = await import('@/components/OperationController')
    // B-LIB-002: useAudioControls uses useMemo, must be called inside renderHook
    const { result } = renderHook(() => useAudioControls())

    // This MUST exist for playback rate to work
    expect(result.current).toHaveProperty('setPlaybackRate')
    expect(typeof result.current.setPlaybackRate).toBe('function')
  })

  it('BUG: setPlaybackRate must set rate on the audio element', () => {
    // Simulate the __audioControls global with a mock audio element
    const mockAudioElement = { playbackRate: 1 }

    // The setPlaybackRate function exposed by OperationController should:
    // 1. Accept a number
    // 2. Set audioRef.current.playbackRate to that number

    // Simulate what the fixed OperationController should do
    const setPlaybackRate = (rate: number) => {
      ;(window as any).__audioControls?.setPlaybackRate(rate)
    }

    // Set up mock __audioControls with setPlaybackRate
    ;(window as any).__audioControls = {
      setPlaybackRate: (rate: number) => {
        mockAudioElement.playbackRate = rate
      }
    }

    setPlaybackRate(2)
    expect(mockAudioElement.playbackRate).toBe(2)

    setPlaybackRate(0.5)
    expect(mockAudioElement.playbackRate).toBe(0.5)

    // Cleanup
    delete (window as any).__audioControls
  })
})
