import { create } from 'zustand'
import type { KnowledgeSearchResult } from '../types/models'

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
      await window.electronAPI.knowledge.addSource(path)
    } catch (error) {
      console.error('[KnowledgeStore] Failed to add source:', error)
    }
  },

  removeSource: async (path) => {
    try {
      await window.electronAPI.knowledge.removeSource(path)
    } catch (error) {
      console.error('[KnowledgeStore] Failed to remove source:', error)
    }
  },

  search: async (query, topK) => {
    try {
      const searchResults = await window.electronAPI.knowledge.search(query, topK)
      set({ searchResults })
    } catch (error) {
      console.error('[KnowledgeStore] Failed to search knowledge base:', error)
    }
  },

  reindex: async () => {
    set({ indexing: true, indexProgress: null })
    try {
      await window.electronAPI.knowledge.reindex()
    } catch (error) {
      console.error('[KnowledgeStore] Failed to reindex:', error)
      set({ indexing: false })
    }
  },
}))

export function initKnowledgeStore(): () => void {
  const unsub1 = window.electronAPI.knowledge.onIndexProgress((data) => {
    useKnowledgeStore.setState({
      indexing: true,
      indexProgress: { current: data.chunksProcessed, total: data.totalChunks },
    })
  })

  const unsub2 = window.electronAPI.knowledge.onIndexComplete((_data) => {
    useKnowledgeStore.setState({ indexing: false, indexProgress: null })
  })

  return () => {
    unsub1()
    unsub2()
  }
}
