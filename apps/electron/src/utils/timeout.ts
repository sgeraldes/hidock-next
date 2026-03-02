/**
 * Timeout Utilities with AbortController Support
 *
 * CRITICAL: This file implements the correct AbortController pattern.
 * - AbortController owns the abort() method
 * - AbortSignal is read-only and should never have abort() called on it
 *
 * Related: spec-004, spec-009
 */

/**
 * Wraps a promise with a timeout that can abort the operation.
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param controller - Optional AbortController to abort on timeout
 * @returns Promise that rejects with AbortError on timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller?: AbortController
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Abort the operation via controller (not signal!)
      if (controller && !controller.signal.aborted) {
        controller.abort()
      }
      reject(new DOMException(`Operation timed out after ${timeoutMs}ms`, 'AbortError'))
    }, timeoutMs)

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer))
  })
}

/**
 * Sleep with abort support.
 *
 * @param ms - Duration in milliseconds
 * @param signal - Optional AbortSignal to cancel the sleep
 * @returns Promise that resolves after delay or rejects with AbortError if aborted
 */
export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Sleep aborted', 'AbortError'))
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const abortHandler = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      cleanup()
      reject(new DOMException('Sleep aborted', 'AbortError'))
    }

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler)
      }
    }

    timer = setTimeout(() => {
      timer = null
      cleanup()
      resolve()
    }, ms)

    if (signal) {
      signal.addEventListener('abort', abortHandler)
    }
  })
}

/**
 * Check if an error is an abort error.
 *
 * @param error - The error to check
 * @returns True if the error is an AbortError
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
