import { useAppStore } from '../stores/app-store'
import { useSessionStore } from '../stores/session-store'
import type { Session } from '../types/models'

export interface ActiveSessionInfo {
  session: Session | null
  isRecording: boolean
  isActive: boolean
}

/**
 * Convenience hook that combines the active session ID from the app store
 * with the full session object from the session store.
 */
export function useActiveSession(): ActiveSessionInfo {
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessions = useSessionStore((s) => s.sessions)

  const session = activeSessionId
    ? (sessions.find((s) => s.id === activeSessionId) ?? null)
    : null

  const isRecording = session?.status === 'recording'
  const isActive = session !== null

  return { session, isRecording, isActive }
}
