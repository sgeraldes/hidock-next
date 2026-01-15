import { lazy, ComponentType } from 'react'

/**
 * Wraps React.lazy() with automatic retry logic for loading chunks.
 * This helps handle network flakiness when loading code-split chunks,
 * particularly useful in Electron apps where network conditions may vary.
 *
 * @param importFn - Dynamic import function returning a component module
 * @param retries - Number of retry attempts (default: 3)
 * @param delay - Base delay in ms between retries, multiplied by attempt number (default: 1000)
 * @returns A lazy-loaded React component with retry capability
 *
 * @example
 * const Home = lazyWithRetry(() => import('@/pages/Home'))
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>,
  retries = 3,
  delay = 1000
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await importFn()
      } catch (error) {
        if (attempt === retries - 1) throw error
        // Exponential backoff: delay increases with each attempt
        await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)))
      }
    }
    // TypeScript requires this, but it's never reached
    throw new Error('Unreachable')
  })
}
