import { create } from 'zustand'
import type { SettingsKey, SettingsMap } from '../types/models'

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
      const settings = await window.electronAPI.settings.getAll()
      set({ settings, loading: false })
    } catch (error) {
      console.error('[SettingsStore] Failed to fetch all settings:', error)
      set({ loading: false })
    }
  },

  get: async (key) => {
    try {
      const value = await window.electronAPI.settings.get(key)
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
      await window.electronAPI.settings.set(key, value)
      set((state) => ({ settings: { ...state.settings, [key]: value } }))
    } catch (error) {
      console.error('[SettingsStore] Failed to set setting:', key, error)
    }
  },

  fetchCategory: async (category) => {
    try {
      const group = await window.electronAPI.settings.getCategory(category)
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
      return await window.electronAPI.settings.testConnection()
    } catch (error) {
      console.error('[SettingsStore] Failed to test connection:', error)
      return { success: false, error: String(error) }
    }
  },
}))

export function initSettingsStore(): () => void {
  const unsub1 = window.electronAPI.settings.onChanged((data) => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, [data.key]: data.value },
    }))
  })

  return () => {
    unsub1()
  }
}
