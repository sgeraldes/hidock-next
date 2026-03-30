import { create } from 'zustand'
import type { Session } from '../types/models'

interface SessionState {
  sessions: Session[]
  loading: boolean
  // Actions
  fetchSessions: () => Promise<void>
  createSession: () => Promise<Session | null>
  endSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  linkMeeting: (sessionId: string, meetingId: string) => Promise<void>
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  loading: false,

  fetchSessions: async () => {
    set({ loading: true })
    try {
      const sessions = await window.electronAPI.session.list()
      set({ sessions, loading: false })
    } catch (error) {
      console.error('[SessionStore] Failed to fetch sessions:', error)
      set({ loading: false })
    }
  },

  createSession: async () => {
    try {
      const session = await window.electronAPI.session.create()
      set((state) => ({ sessions: [session, ...state.sessions] }))
      return session
    } catch (error) {
      console.error('[SessionStore] Failed to create session:', error)
      return null
    }
  },

  endSession: async (id) => {
    try {
      const updated = await window.electronAPI.session.end(id)
      if (updated) {
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === id ? updated : s)),
        }))
      }
    } catch (error) {
      console.error('[SessionStore] Failed to end session:', error)
    }
  },

  deleteSession: async (id) => {
    try {
      await window.electronAPI.session.delete(id)
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
      }))
    } catch (error) {
      console.error('[SessionStore] Failed to delete session:', error)
    }
  },

  linkMeeting: async (sessionId, meetingId) => {
    try {
      const updated = await window.electronAPI.session.linkMeeting(sessionId, meetingId)
      if (updated) {
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === sessionId ? updated : s)),
        }))
      }
    } catch (error) {
      console.error('[SessionStore] Failed to link meeting:', error)
    }
  },
}))

export function initSessionStore(): () => void {
  const unsub1 = window.electronAPI.session.onCreated((data) => {
    useSessionStore.setState((state) => {
      const exists = state.sessions.some((s) => s.id === data.id)
      if (exists) return state
      return { sessions: [data, ...state.sessions] }
    })
  })

  const unsub2 = window.electronAPI.session.onUpdated((data) => {
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((s) => (s.id === data.id ? data : s)),
    }))
  })

  const unsub3 = window.electronAPI.session.onDeleted((data) => {
    useSessionStore.setState((state) => ({
      sessions: state.sessions.filter((s) => s.id !== data.sessionId),
    }))
  })

  const unsub4 = window.electronAPI.session.onStatusChanged((data) => {
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((s) => (s.id === data.id ? data : s)),
    }))
  })

  return () => {
    unsub1()
    unsub2()
    unsub3()
    unsub4()
  }
}
