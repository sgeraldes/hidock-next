import { create } from 'zustand'
import type { Suggestion } from '../types/models'
import { getElectronAPI } from '../lib/electron-api'

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
      const api = getElectronAPI()
      if (!api) return set({ loading: false })
      const suggestions = await api.suggestion.getActive(sessionId)
      set({ suggestions, loading: false })
    } catch (error) {
      console.error('[SuggestionStore] Failed to fetch active suggestions:', error)
      set({ loading: false })
    }
  },

  dismiss: async (suggestionId) => {
    try {
      const api = getElectronAPI()
      if (!api) return
      await api.suggestion.dismiss(suggestionId)
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
  const api = getElectronAPI()
  if (!api) return () => {}

  const unsub1 = api.suggestion.onUpdated((data) => {
    useSuggestionStore.setState({ suggestions: data })
  })

  const unsub2 = api.suggestion.onCleared((_data) => {
    useSuggestionStore.setState({ suggestions: [] })
  })

  return () => {
    unsub1()
    unsub2()
  }
}
