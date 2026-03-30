import { useEffect } from 'react'

/**
 * Subscribe to an IPC push event. Automatically cleans up on unmount.
 *
 * Usage:
 *   useIPC(
 *     (cb) => window.electronAPI.session.onCreated(cb),
 *     (session) => { ... }
 *   )
 *
 * The subscribe function and callback should be stable references (defined
 * outside the component or wrapped in useCallback) to prevent re-subscribing
 * on every render.
 */
export function useIPC(
  subscribe: (callback: (...args: any[]) => void) => () => void,
  callback: (...args: any[]) => void,
): void {
  useEffect(() => {
    const unsubscribe = subscribe(callback)
    return unsubscribe
    // subscribe and callback must be stable refs — intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
