/**
 * useBulkOperation - AbortController-based bulk operations manager
 *
 * Provides cancellation, progress tracking, and status management for
 * bulk download and transcription operations.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { LibraryError, parseError } from '@/features/library/utils/errorHandling'

export type BulkItemStatus = 'pending' | 'processing' | 'success' | 'failed' | 'cancelled'

export interface BulkOperationItem<T = unknown> {
  id: string
  data: T
  status: BulkItemStatus
  error?: LibraryError
  progress?: number // 0-100 for items with progress (downloads)
}

export interface BulkOperationOptions<T> {
  items: Array<{ id: string; data: T }>
  operation: (item: T, signal: AbortSignal, onProgress?: (percent: number) => void) => Promise<void>
  onItemStatusChange?: (id: string, status: BulkItemStatus, error?: LibraryError) => void
  onComplete?: (results: BulkOperationResult) => void
  errorContext?: 'download' | 'transcription' | 'delete'
}

export interface BulkOperationResult {
  succeeded: string[]
  failed: Array<{ id: string; error: LibraryError }>
  cancelled: string[]
  wasAborted: boolean
}

export interface BulkOperationState {
  isRunning: boolean
  items: Map<string, BulkOperationItem>
  progress: { current: number; total: number }
  abort: () => void
  retry: (ids: string[]) => void
}

/**
 * Hook for managing bulk operations with AbortController support
 */
export function useBulkOperation<T>(options: BulkOperationOptions<T>): BulkOperationState {
  const [items, setItems] = useState<Map<string, BulkOperationItem>>(() => new Map())
  const [isRunning, setIsRunning] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  const itemsRef = useRef(items)

  // Keep refs up to date to avoid stale closures
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const start = useCallback(
    async (itemsToProcess: Array<{ id: string; data: T }>) => {
      // Create new AbortController for this run
      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal
      setIsRunning(true)

      // Initialize all items as pending
      const initialItems = new Map(
        itemsToProcess.map(({ id, data }) => [id, { id, data, status: 'pending' as const }])
      )
      setItems(initialItems)

      const results: BulkOperationResult = {
        succeeded: [],
        failed: [],
        cancelled: [],
        wasAborted: false
      }

      // Process each item sequentially
      for (const { id, data } of itemsToProcess) {
        // Check if aborted before starting this item
        if (signal.aborted) {
          // Collect pending IDs using ref to avoid stale closure
          const pendingIds: string[] = []
          for (const [itemId, item] of itemsRef.current) {
            if (item.status === 'pending') {
              pendingIds.push(itemId)
            }
          }
          results.cancelled.push(...pendingIds)

          // Then update state
          setItems((prev) => {
            const next = new Map(prev)
            for (const itemId of pendingIds) {
              const item = next.get(itemId)
              if (item) {
                next.set(itemId, { ...item, status: 'cancelled' })
                optionsRef.current.onItemStatusChange?.(itemId, 'cancelled')
              }
            }
            return next
          })
          results.wasAborted = true
          break
        }

        // Update to processing
        setItems((prev) => {
          const next = new Map(prev)
          const item = next.get(id)!
          next.set(id, { ...item, status: 'processing' })
          return next
        })
        optionsRef.current.onItemStatusChange?.(id, 'processing')

        try {
          // Execute operation with signal and progress callback
          await optionsRef.current.operation(data, signal, (progress) => {
            setItems((prev) => {
              const next = new Map(prev)
              const item = next.get(id)!
              next.set(id, { ...item, progress })
              return next
            })
          })

          // Success
          setItems((prev) => {
            const next = new Map(prev)
            const item = next.get(id)!
            next.set(id, { ...item, status: 'success', progress: 100 })
            return next
          })
          optionsRef.current.onItemStatusChange?.(id, 'success')
          results.succeeded.push(id)
        } catch (error) {
          // Check if this was an abort error
          const isAborted =
            (error instanceof Error && error.name === 'AbortError') ||
            (error instanceof DOMException && error.name === 'AbortError') ||
            signal.aborted

          if (isAborted) {
            setItems((prev) => {
              const next = new Map(prev)
              const item = next.get(id)!
              next.set(id, { ...item, status: 'cancelled' })
              return next
            })
            optionsRef.current.onItemStatusChange?.(id, 'cancelled')
            results.cancelled.push(id)
          } else {
            // Regular error - parse and categorize
            const libraryError = parseError(error, optionsRef.current.errorContext ?? 'download')
            setItems((prev) => {
              const next = new Map(prev)
              const item = next.get(id)!
              next.set(id, { ...item, status: 'failed', error: libraryError })
              return next
            })
            optionsRef.current.onItemStatusChange?.(id, 'failed', libraryError)
            results.failed.push({ id, error: libraryError })
          }
        }
      }

      setIsRunning(false)
      optionsRef.current.onComplete?.(results)
    },
    []
  )

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  const retry = useCallback(
    (ids: string[]) => {
      // Filter to only the items that need retry
      const itemsToRetry = optionsRef.current.items.filter((item) => ids.includes(item.id))
      if (itemsToRetry.length > 0) {
        start(itemsToRetry)
      }
    },
    [start]
  )

  // Auto-start on mount with initial items
  useEffect(() => {
    if (options.items.length > 0) {
      start(options.items)
    }
  }, []) // Only run on mount

  // Cleanup on unmount - abort any running operations
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  // Calculate progress based on completed items
  const progress = {
    current: Array.from(items.values()).filter(
      (i) => i.status === 'success' || i.status === 'failed' || i.status === 'cancelled'
    ).length,
    total: items.size
  }

  return {
    isRunning,
    items,
    progress,
    abort,
    retry
  }
}
