import { create } from 'zustand'
import type { AppConfig } from '@/types'

interface ConfigState {
  config: AppConfig | null
  configLoading: boolean
  configReady: boolean // True ONLY when config has been loaded from main process

  setConfig: (config: AppConfig) => void
  loadConfig: () => Promise<void>
  updateConfig: <K extends keyof AppConfig>(section: K, values: Partial<AppConfig[K]>) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  configLoading: false,
  configReady: false,

  setConfig: (config) => set({ config }),

  loadConfig: async () => {
    set({ configLoading: true })
    try {
      const result = await window.electronAPI.config.get()
      if (result.success) {
        set({ config: result.data, configLoading: false, configReady: true })
      } else {
        const errorMessage = result.error?.message || 'Failed to load configuration'
        throw new Error(errorMessage)
      }
    } catch (error) {
      console.error('Failed to load config:', error)
      set({ configLoading: false, configReady: true }) // Ready with null = safe default
      throw error // Re-throw for UI error handling
    }
  },

  updateConfig: async (section, values) => {
    try {
      const result = await window.electronAPI.config.updateSection(section, values)
      if (result.success) {
        set({ config: result.data })
      } else {
        const errorMessage = result.error?.message || 'Failed to update configuration'
        throw new Error(errorMessage)
      }
    } catch (error) {
      console.error('Failed to update config:', error)
      throw error // Re-throw for UI error handling
    }
  },
}))
