/**
 * useValueSuggestionToasts tests (F16/spec-003 Part F).
 *
 * The critical regression this guards: a backfill of many captures must NEVER
 * spam the toaster. Since the backfill emits no per-capture events at all
 * (only the live path does), the coalescing behavior only needs to prove that
 * N events arriving within the debounce window collapse into exactly ONE
 * summary toast — the live-path burst case (several captures classified
 * moments apart).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useValueSuggestionToasts } from '../useValueSuggestionToasts'

const toastInfoMock = vi.fn()
vi.mock('@/components/ui/toaster', () => ({
  toast: {
    info: (...args: unknown[]) => toastInfoMock(...args),
    success: vi.fn(),
    error: vi.fn()
  }
}))

interface MockDomainEvent {
  type: string
  payload: unknown
}

function setupElectronAPI() {
  let handler: ((event: MockDomainEvent) => void) | null = null
  const unsubscribe = vi.fn()
  const onDomainEvent = vi.fn((cb: (event: MockDomainEvent) => void) => {
    handler = cb
    return unsubscribe
  })
  const markPersonal = vi.fn().mockResolvedValue({ success: true, personal: true })

  ;(window as any).electronAPI = {
    onDomainEvent,
    recordings: { markPersonal }
  }

  return {
    emit: (event: MockDomainEvent) => act(() => void handler?.(event)),
    unsubscribe,
    onDomainEvent,
    markPersonal
  }
}

function valueClassifiedEvent(overrides: Partial<{ recordingId: string; captureId: string; rating: string; reasons: string[] }> = {}) {
  return {
    type: 'capture:value-classified',
    payload: {
      recordingId: 'rec-1',
      captureId: 'cap-1',
      rating: 'low-value',
      reasons: [],
      ...overrides
    }
  }
}

describe('useValueSuggestionToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    toastInfoMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).electronAPI
  })

  it('does nothing when window.electronAPI.onDomainEvent is unavailable (no crash)', () => {
    delete (window as any).electronAPI
    expect(() => renderHook(() => useValueSuggestionToasts({ refresh: vi.fn() }))).not.toThrow()
  })

  it('ignores domain events of a different type', async () => {
    const api = setupElectronAPI()
    renderHook(() => useValueSuggestionToasts({ refresh: vi.fn(), debounceMs: 100 }))

    api.emit({ type: 'calendar:synced', payload: {} })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(toastInfoMock).not.toHaveBeenCalled()
  })

  it('a single event produces exactly ONE toast naming a low-value rating', async () => {
    const api = setupElectronAPI()
    renderHook(() => useValueSuggestionToasts({ refresh: vi.fn(), debounceMs: 100 }))

    api.emit(valueClassifiedEvent({ rating: 'low-value', reasons: ['personal_family'] }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(toastInfoMock).toHaveBeenCalledTimes(1)
    expect(toastInfoMock.mock.calls[0][0]).toBe('Marked low-value')
    expect(toastInfoMock.mock.calls[0][1]).toBe('Personal / family')
  })

  it('a single event names a garbage rating', async () => {
    const api = setupElectronAPI()
    renderHook(() => useValueSuggestionToasts({ refresh: vi.fn(), debounceMs: 100 }))

    api.emit(valueClassifiedEvent({ rating: 'garbage', reasons: [] }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(toastInfoMock.mock.calls[0][0]).toBe('Marked garbage')
    // No reasons -> falls back to the "AI-assessed" description.
    expect(toastInfoMock.mock.calls[0][1]).toBe('AI-assessed')
  })

  it('the single-event toast has a working "Mark personal" action, opt-in only', async () => {
    const api = setupElectronAPI()
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useValueSuggestionToasts({ refresh, debounceMs: 100 }))

    api.emit(valueClassifiedEvent({ recordingId: 'rec-42' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    // Personal is never auto-applied — only after the user clicks the action.
    expect(api.markPersonal).not.toHaveBeenCalled()

    const opts = toastInfoMock.mock.calls[0][2] as { action: { label: string; onClick: () => void } }
    expect(opts.action.label).toBe('Mark personal')
    opts.action.onClick()

    expect(api.markPersonal).toHaveBeenCalledWith('rec-42', true)
    await act(async () => {
      await Promise.resolve()
    })
    expect(refresh).toHaveBeenCalledWith(false)
  })

  it('coalesces N events within the debounce window into exactly ONE summary toast', async () => {
    const api = setupElectronAPI()
    renderHook(() => useValueSuggestionToasts({ refresh: vi.fn(), debounceMs: 100 }))

    api.emit(valueClassifiedEvent({ recordingId: 'r1', captureId: 'c1' }))
    api.emit(valueClassifiedEvent({ recordingId: 'r2', captureId: 'c2', rating: 'garbage' }))
    api.emit(valueClassifiedEvent({ recordingId: 'r3', captureId: 'c3' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    // The core regression guard: many events, exactly ONE toast — never one per capture.
    expect(toastInfoMock).toHaveBeenCalledTimes(1)
    expect(toastInfoMock.mock.calls[0][0]).toBe('3 captures marked low value')
  })

  it('the aggregated toast has a "Review" action (no per-row Mark-personal)', async () => {
    const api = setupElectronAPI()
    const onReview = vi.fn()
    renderHook(() => useValueSuggestionToasts({ refresh: vi.fn(), onReview, debounceMs: 100 }))

    api.emit(valueClassifiedEvent({ recordingId: 'r1', captureId: 'c1' }))
    api.emit(valueClassifiedEvent({ recordingId: 'r2', captureId: 'c2' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    const opts = toastInfoMock.mock.calls[0][2] as { action: { label: string; onClick: () => void } }
    expect(opts.action.label).toBe('Review')
    opts.action.onClick()
    expect(onReview).toHaveBeenCalledTimes(1)
    expect(api.markPersonal).not.toHaveBeenCalled()
  })

  it('a burst that arrives in two separate debounce windows produces TWO toasts, not one', async () => {
    const api = setupElectronAPI()
    renderHook(() => useValueSuggestionToasts({ refresh: vi.fn(), debounceMs: 100 }))

    api.emit(valueClassifiedEvent({ recordingId: 'r1', captureId: 'c1' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150) // first window flushes
    })
    api.emit(valueClassifiedEvent({ recordingId: 'r2', captureId: 'c2' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150) // second window flushes
    })

    expect(toastInfoMock).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes from onDomainEvent on unmount', () => {
    const api = setupElectronAPI()
    const { unmount } = renderHook(() => useValueSuggestionToasts({ refresh: vi.fn() }))
    unmount()
    expect(api.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('ignores a malformed payload missing required fields', async () => {
    const api = setupElectronAPI()
    renderHook(() => useValueSuggestionToasts({ refresh: vi.fn(), debounceMs: 100 }))

    api.emit({ type: 'capture:value-classified', payload: { recordingId: 'r1' } }) // no captureId/rating
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(toastInfoMock).not.toHaveBeenCalled()
  })
})
