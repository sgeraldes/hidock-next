/**
 * Tests for timeout utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withTimeout, sleepWithAbort, isAbortError } from '../timeout'

describe('Timeout Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('withTimeout', () => {
    it('should resolve when promise completes before timeout', async () => {
      const controller = new AbortController()
      const promise = Promise.resolve('success')

      const result = withTimeout(promise, 1000, controller)

      await expect(result).resolves.toBe('success')
      expect(controller.signal.aborted).toBe(false)
    })

    it('should abort and reject when timeout occurs', async () => {
      const controller = new AbortController()
      const promise = new Promise((resolve) => setTimeout(resolve, 2000))

      const result = withTimeout(promise, 1000, controller)

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(1000)

      await expect(result).rejects.toThrow('Operation timed out after 1000ms')
      await expect(result).rejects.toMatchObject({
        name: 'AbortError'
      })
      expect(controller.signal.aborted).toBe(true)
    })

    it('should work without controller', async () => {
      const promise = Promise.resolve('success')
      const result = withTimeout(promise, 1000)
      await expect(result).resolves.toBe('success')
    })

    it('should not abort if controller signal already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const promise = new Promise((resolve) => setTimeout(resolve, 2000))
      const result = withTimeout(promise, 1000, controller)

      vi.advanceTimersByTime(1000)

      await expect(result).rejects.toThrow('Operation timed out after 1000ms')
    })

    it('should propagate promise rejection', async () => {
      const controller = new AbortController()
      const error = new Error('Test error')
      const promise = Promise.reject(error)

      await expect(withTimeout(promise, 1000, controller)).rejects.toThrow('Test error')
    })
  })

  describe('sleepWithAbort', () => {
    it('should resolve after specified time', async () => {
      const promise = sleepWithAbort(1000)

      vi.advanceTimersByTime(1000)

      await expect(promise).resolves.toBeUndefined()
    })

    it('should abort immediately if signal already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(sleepWithAbort(1000, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Sleep aborted'
      })
    })

    it('should abort when signal is aborted during sleep', async () => {
      const controller = new AbortController()
      const promise = sleepWithAbort(2000, controller.signal)

      // Advance halfway through
      vi.advanceTimersByTime(1000)

      // Abort now
      controller.abort()

      await expect(promise).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Sleep aborted'
      })
    })

    it('should remove event listener after completion', async () => {
      const controller = new AbortController()
      const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')

      const promise = sleepWithAbort(1000, controller.signal)

      vi.advanceTimersByTime(1000)

      await promise

      expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    })

    it('should remove event listener after abort', async () => {
      const controller = new AbortController()
      const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')

      const promise = sleepWithAbort(2000, controller.signal)

      vi.advanceTimersByTime(1000)
      controller.abort()

      try {
        await promise
      } catch {
        // Expected to throw
      }

      expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    })
  })

  describe('isAbortError', () => {
    it('should return true for DOMException with AbortError name', () => {
      const error = new DOMException('Aborted', 'AbortError')
      expect(isAbortError(error)).toBe(true)
    })

    it('should return false for regular Error', () => {
      const error = new Error('Not an abort error')
      expect(isAbortError(error)).toBe(false)
    })

    it('should return false for DOMException with different name', () => {
      const error = new DOMException('Some error', 'SomeError')
      expect(isAbortError(error)).toBe(false)
    })

    it('should return false for non-error values', () => {
      expect(isAbortError('string')).toBe(false)
      expect(isAbortError(null)).toBe(false)
      expect(isAbortError(undefined)).toBe(false)
      expect(isAbortError(42)).toBe(false)
    })
  })
})
