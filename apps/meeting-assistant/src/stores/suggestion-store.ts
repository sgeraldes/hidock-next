import { create } from 'zustand'
import type { Suggestion } from '../types/models'

interface SuggestionState {
  suggestions: Suggestion[]
  loading: boolean
  // Actions
  fetchActive: (sessionId: string) => Promise<void>
  dismiss: (suggestionId: string) => Promise<void>
}

export const useSuggestionStore = create<SuggestionState>((set) => ({
  suggestions: [],
  loading: false,

  fetchActive: async (sessionId) => {
    set({ loading: true })
    try {
      const suggestions = await window.electronAPI.suggestion.getActive(sessionId)
      set({ suggestions, loading: false })
    } catch (error) {
      console.error('[SuggestionStore] Failed to fetch active suggestions:', error)
      set({ loading: false })
    }
  },

  dismiss: async (suggestionId) => {
    try {
      await window.electronAPI.suggestion.dismiss(suggestionId)
      set((state) => ({
        suggestions: state.suggestions.map((s) =>
          s.id === suggestionId ? { ...s, dismissed: true } : s
        ),
      }))
    } catch (error) {
      console.error('[SuggestionStore] Failed to dismiss suggestion:', error)
    }
  },
}))

export function initSuggestionStore(): () => void {
  const unsub1 = window.electronAPI.suggestion.onUpdated((data) => {
    useSuggestionStore.setState({ suggestions: data })
  })

  const unsub2 = window.electronAPI.suggestion.onCleared((_data) => {
    useSuggestionStore.setState({ suggestions: [] })
  })

  return () => {
    unsub1()
    unsub2()
  }
}
