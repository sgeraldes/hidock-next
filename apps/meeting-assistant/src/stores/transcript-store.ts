import { create } from 'zustand'
import type { TranscriptSegment } from '../types/models'

const MAX_SEGMENTS = 10000

interface TranscriptState {
  segments: TranscriptSegment[]
  interimText: string
  status: string
  // Actions
  fetchSegments: (sessionId: string, offset?: number, limit?: number) => Promise<void>
  fetchRecent: (sessionId: string, maxAgeSecs?: number, maxCount?: number) => Promise<void>
  clear: () => void
}

export const useTranscriptStore = create<TranscriptState>((set) => ({
  segments: [],
  interimText: '',
  status: '',

  fetchSegments: async (sessionId, offset, limit) => {
    try {
      const segments = await window.electronAPI.transcript.getSegments(sessionId, offset, limit)
      set({ segments })
    } catch (error) {
      console.error('[TranscriptStore] Failed to fetch segments:', error)
    }
  },

  fetchRecent: async (sessionId, maxAgeSecs, maxCount) => {
    try {
      const segments = await window.electronAPI.transcript.getRecent(sessionId, maxAgeSecs, maxCount)
      set({ segments })
    } catch (error) {
      console.error('[TranscriptStore] Failed to fetch recent segments:', error)
    }
  },

  clear: () => set({ segments: [], interimText: '', status: '' }),
}))

export function initTranscriptStore(): () => void {
  const unsub1 = window.electronAPI.transcript.onNewSegments((data) => {
    useTranscriptStore.setState((state) => {
      const combined = [...state.segments, ...data]
      const trimmed =
        combined.length > MAX_SEGMENTS ? combined.slice(combined.length - MAX_SEGMENTS) : combined
      return { segments: trimmed }
    })
  })

  const unsub2 = window.electronAPI.transcript.onInterimResult((data) => {
    useTranscriptStore.setState({ interimText: data.isFinal ? '' : data.text })
  })

  const unsub3 = window.electronAPI.transcript.onStatus((status) => {
    useTranscriptStore.setState({ status: status.recording ? 'recording' : 'idle' })
  })

  const unsub4 = window.electronAPI.transcript.onError((error) => {
    console.error('[TranscriptStore] Transcript error:', error.message)
    useTranscriptStore.setState({ status: 'error' })
  })

  return () => {
    unsub1()
    unsub2()
    unsub3()
    unsub4()
  }
}
