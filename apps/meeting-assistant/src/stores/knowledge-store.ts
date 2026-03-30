import { create } from 'zustand'
import type { KnowledgeSearchResult } from '../types/models'
import type { KbSourceRecord } from '../types/electron-api'
import { getElectronAPI } from '../lib/electron-api'

export type { KbSourceRecord }

interface KnowledgeState {
  searchResults: KnowledgeSearchResult[]
  indexing: boolean
  indexProgress: { current: number; total: number } | null
  sources: KbSourceRecord[]
  // Actions
  addSource: (path: string) => Promise<void>
  removeSource: (path: string) => Promise<void>
  search: (query: string, topK?: number) => Promise<void>
  reindex: () => Promise<void>
  loadSources: () => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  searchResults: [],
  indexing: false,
  indexProgress: null,
  sources: [],

  loadSources: async () => {
    try {
      const api = getElectronAPI()
      if (!api) return
      const dbSources = await api.knowledge.listSources()
      if (dbSources) {
        set({ sources: dbSources })
      }
    } catch (error) {
      console.error('[KnowledgeStore] Failed to load sources:', error)
    }
  },

  addSource: async (path) => {
    set({ indexing: true })
    try {
      const api = getElectronAPI()
      if (!api) return
      await api.knowledge.addSource(path)
      // Refresh sources list from DB after successful add
      const dbSources = await api.knowledge.listSources()
      if (dbSources) {
        set({ sources: dbSources })
      }
    } catch (error) {
      console.error('[KnowledgeStore] Failed to add source:', error)
    } finally {
      set({ indexing: false })
    }
  },

  removeSource: async (path) => {
    try {
      const api = getElectronAPI()
      if (!api) return
      await api.knowledge.removeSource(path)
      // Refresh sources list from DB after successful remove
      const dbSources = await api.knowledge.listSources()
      if (dbSources) {
        set({ sources: dbSources })
      }
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
      if (!api) return
      await api.knowledge.reindex()
    } catch (error) {
      console.error('[KnowledgeStore] Failed to reindex:', error)
    } finally {
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
