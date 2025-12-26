import { useState, useCallback, useRef } from 'react'

/**
 * Options for optimistic mutation hook
 */
export interface UseOptimisticMutationOptions<TData, TVariables, TContext> {
  /**
   * The mutation function to execute
   */
  mutationFn: (variables: TVariables) => Promise<TData>

  /**
   * Called immediately before mutation
   * Return value is passed to onError and onSuccess as context
   */
  onMutate?: (variables: TVariables) => TContext | Promise<TContext>

  /**
   * Called if mutation succeeds
   */
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => void | Promise<void>

  /**
   * Called if mutation fails
   * Should rollback optimistic updates using context
   */
  onError?: (error: Error, variables: TVariables, context: TContext) => void | Promise<void>

  /**
   * Called after mutation completes (success or error)
   */
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    variables: TVariables,
    context: TContext
  ) => void | Promise<void>
}

/**
 * Return type for optimistic mutation hook
 */
export interface UseOptimisticMutationResult<TData, TVariables> {
  /**
   * Execute the mutation
   */
  mutate: (variables: TVariables) => Promise<void>

  /**
   * Execute the mutation and return the result
   */
  mutateAsync: (variables: TVariables) => Promise<TData>

  /**
   * Whether mutation is currently in progress
   */
  isLoading: boolean

  /**
   * Error from the last mutation attempt (if any)
   */
  error: Error | null

  /**
   * Data from the last successful mutation (if any)
   */
  data: TData | undefined

  /**
   * Reset mutation state
   */
  reset: () => void
}

/**
 * Hook for performing mutations with optimistic updates
 *
 * Optimistic updates improve perceived performance by updating the UI immediately,
 * then rolling back if the server request fails.
 *
 * @example
 * ```tsx
 * const updateRecording = useOptimisticMutation({
 *   mutationFn: async (id: string) => {
 *     return window.electronAPI.recordings.updateStatus(id, 'transcribed')
 *   },
 *   onMutate: (id) => {
 *     // Apply optimistic update
 *     const previousRecordings = recordings
 *     setRecordings(recordings.map(r =>
 *       r.id === id ? { ...r, status: 'transcribed' } : r
 *     ))
 *     return { previousRecordings }
 *   },
 *   onError: (err, id, context) => {
 *     // Rollback on error
 *     setRecordings(context.previousRecordings)
 *     toast.error('Failed to update recording')
 *   },
 *   onSuccess: (data) => {
 *     toast.success('Recording updated')
 *   }
 * })
 *
 * // Use it
 * <button onClick={() => updateRecording.mutate(recordingId)}>
 *   Update
 * </button>
 * ```
 */
export function useOptimisticMutation<TData = unknown, TVariables = unknown, TContext = unknown>(
  options: UseOptimisticMutationOptions<TData, TVariables, TContext>
): UseOptimisticMutationResult<TData, TVariables> {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [data, setData] = useState<TData | undefined>(undefined)

  // Use ref to avoid stale closures in callbacks
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Track if component is mounted to avoid state updates after unmount
  const isMountedRef = useRef(true)
  useCallback(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      const { mutationFn, onMutate, onSuccess, onError, onSettled } = optionsRef.current

      // Set loading state
      if (isMountedRef.current) {
        setIsLoading(true)
        setError(null)
      }

      let context: TContext = undefined as TContext
      let mutationError: Error | null = null
      let mutationData: TData | undefined = undefined

      try {
        // Execute onMutate (optimistic update)
        if (onMutate) {
          context = await onMutate(variables)
        }

        // Execute mutation
        mutationData = await mutationFn(variables)

        // Update data state
        if (isMountedRef.current) {
          setData(mutationData)
        }

        // Call onSuccess
        if (onSuccess) {
          await onSuccess(mutationData, variables, context)
        }

        return mutationData
      } catch (err) {
        // Convert to Error type
        mutationError = err instanceof Error ? err : new Error(String(err))

        // Update error state
        if (isMountedRef.current) {
          setError(mutationError)
        }

        // Call onError (rollback optimistic update)
        if (onError) {
          await onError(mutationError, variables, context)
        }

        // Re-throw so caller can handle
        throw mutationError
      } finally {
        // Set loading to false
        if (isMountedRef.current) {
          setIsLoading(false)
        }

        // Call onSettled
        if (onSettled) {
          await onSettled(mutationData, mutationError, variables, context)
        }
      }
    },
    []
  )

  const mutate = useCallback(
    async (variables: TVariables): Promise<void> => {
      try {
        await mutateAsync(variables)
      } catch (err) {
        // Error already handled in mutateAsync
        // Swallow here to make mutate() fire-and-forget
      }
    },
    [mutateAsync]
  )

  const reset = useCallback(() => {
    setIsLoading(false)
    setError(null)
    setData(undefined)
  }, [])

  return {
    mutate,
    mutateAsync,
    isLoading,
    error,
    data,
    reset
  }
}
