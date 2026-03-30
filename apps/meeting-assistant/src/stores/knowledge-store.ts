import { create } from 'zustand'
import type { KnowledgeSearchResult } from '../types/models'
import { getElectronAPI } from '../lib/electron-api'

interface KnowledgeState {
  searchResults: KnowledgeSearchResult[]
  indexing: boolean
  indexProgress: { current: number; total: number } | null
  // Actions
  addSource: (path: string) => Promise<void>
  removeSource: (path: string) => Promise<void>
  search: (query: string, topK?: number) => Promise<void>
  reindex: () => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  searchResults: [],
  indexing: false,
  indexProgress: null,

  addSource: async (path) => {
    try {
      const api = getElectronAPI()
      if (!api) return
      await api.knowledge.addSource(path)
    } catch (error) {
      console.error('[KnowledgeStore] Failed to add source:', error)
    }
  },

  removeSource: async (path) => {
    try {
      const api = getElectronAPI()
      if (!api) return
      await api.knowledge.removeSource(path)
    } catch (error) {
      console.error('[KnowledgeStore] Failed to remove source:', error)
    }
  },

  search: async (query, topK) => {
    try {
      const api = getElectronAPI()
      if (!api) return
      const searchResults = await api.knowledge.search(query, topK)
      set({ searchResults })
    } catch (error) {
      console.error('[KnowledgeStore] Failed to search knowledge base:', error)
    }
  },

  reindex: async () => {
    set({ indexing: true, indexProgress: null })
    try {
      const api = getElectronAPI()
      if (!api) return set({ indexing: false })
      await api.knowledge.reindex()
    } catch (error) {
      console.error('[KnowledgeStore] Failed to reindex:', error)
      set({ indexing: false })
    }
  },
}))

export function initKnowledgeStore(): () => void {
  const api = getElectronAPI()
  if (!api) return () => {}

  const unsub1 = api.knowledge.onIndexProgress((data) => {
    useKnowledgeStore.setState({
      indexing: true,
      indexProgress: { current: data.chunksProcessed, total: data.totalChunks },
    })
  })

  const unsub2 = api.knowledge.onIndexComplete((_data) => {
    useKnowledgeStore.setState({ indexing: false, indexProgress: null })
  })

  return () => {
    unsub1()
    unsub2()
  }
}
