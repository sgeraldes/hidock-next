import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToday } from '../useToday'

/**
 * C-CAL-011: Tests for useToday hook interval cleanup
 * Verifies that the setInterval created inside setTimeout is properly
 * cleaned up when the component unmounts, preventing memory leaks.
 */

describe('useToday', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return today\'s date on mount', () => {
    const now = new Date(2026, 2, 2, 10, 0, 0)
    vi.setSystemTime(now)

    const { result } = renderHook(() => useToday())

    expect(result.current.getFullYear()).toBe(2026)
    expect(result.current.getMonth()).toBe(2)
    expect(result.current.getDate()).toBe(2)
  })

  it('should update at midnight', () => {
    const now = new Date(2026, 2, 2, 23, 59, 59, 500)
    vi.setSystemTime(now)

    const { result } = renderHook(() => useToday())

    // Fast-forward to just past midnight, wrapped in act to handle state update
    const nextMidnight = new Date(2026, 2, 3, 0, 0, 0, 0)
    vi.setSystemTime(nextMidnight)
    act(() => {
      vi.advanceTimersByTime(501) // 500ms until midnight + 1ms
    })

    expect(result.current.getDate()).toBe(3)
  })

  it('should clean up both timer and interval on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

    const now = new Date(2026, 2, 2, 10, 0, 0)
    vi.setSystemTime(now)

    const { unmount } = renderHook(() => useToday())

    // Advance past midnight to trigger the interval creation
    const msUntilMidnight = new Date(2026, 2, 3, 0, 0, 0).getTime() - now.getTime()
    vi.setSystemTime(new Date(2026, 2, 3, 0, 0, 0))
    act(() => {
      vi.advanceTimersByTime(msUntilMidnight)
    })

    // Now unmount - should clear both timer and interval
    unmount()

    // clearTimeout should have been called (cleanup function)
    expect(clearTimeoutSpy).toHaveBeenCalled()
    // clearInterval should have been called since interval was created
    expect(clearIntervalSpy).toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('should clean up timer on unmount before midnight', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    const now = new Date(2026, 2, 2, 10, 0, 0)
    vi.setSystemTime(now)

    const { unmount } = renderHook(() => useToday())

    // Unmount before midnight - only timer should be cleared (no interval created yet)
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
  })
})
