import { create } from 'zustand'
import type { SettingsKey, SettingsMap } from '../types/models'
import { getElectronAPI } from '../lib/electron-api'

interface SettingsState {
  settings: Partial<SettingsMap>
  loading: boolean
  // Actions
  fetchAll: () => Promise<void>
  get: <K extends SettingsKey>(key: K) => Promise<SettingsMap[K] | null>
  set: <K extends SettingsKey>(key: K, value: SettingsMap[K]) => Promise<void>
  fetchCategory: (category: string) => Promise<void>
  testConnection: () => Promise<{ success: boolean; error?: string }>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  loading: false,

  fetchAll: async () => {
    set({ loading: true })
    try {
      const api = getElectronAPI()
      if (!api) return set({ loading: false })
      const settings = await api.settings.getAll()
      set({ settings, loading: false })
    } catch (error) {
      console.error('[SettingsStore] Failed to fetch all settings:', error)
      set({ loading: false })
    }
  },

  get: async (key) => {
    try {
      const api = getElectronAPI()
      if (!api) return null
      const value = await api.settings.get(key)
      if (value !== null) {
        set((state) => ({ settings: { ...state.settings, [key]: value } }))
      }
      return value
    } catch (error) {
      console.error('[SettingsStore] Failed to get setting:', key, error)
      return null
    }
  },

  set: async (key, value) => {
    try {
      const api = getElectronAPI()
      if (!api) return
      await api.settings.set(key, value)
      set((state) => ({ settings: { ...state.settings, [key]: value } }))
    } catch (error) {
      console.error('[SettingsStore] Failed to set setting:', key, error)
    }
  },

  fetchCategory: async (category) => {
    try {
      const api = getElectronAPI()
      if (!api) return
      const group = await api.settings.getCategory(category)
      if (group) {
        const patch: Partial<SettingsMap> = {}
        for (const entry of group.settings) {
          ;(patch as Record<string, unknown>)[entry.definition.key] = entry.value
        }
        set((state) => ({ settings: { ...state.settings, ...patch } }))
      }
    } catch (error) {
      console.error('[SettingsStore] Failed to fetch category:', category, error)
    }
  },

  testConnection: async () => {
    try {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Electron API not available' }
      return await api.settings.testConnection()
    } catch (error) {
      console.error('[SettingsStore] Failed to test connection:', error)
      return { success: false, error: String(error) }
    }
  },
}))

export function initSettingsStore(): () => void {
  const api = getElectronAPI()
  if (!api) return () => {}

  const unsub1 = api.settings.onChanged((data) => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, [data.key]: data.value },
    }))
  })

  return () => {
    unsub1()
  }
}
