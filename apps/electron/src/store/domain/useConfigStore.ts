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
      const config = await window.electronAPI.config.get()
      set({ config, configLoading: false, configReady: true })
    } catch (error) {
      console.error('Failed to load config:', error)
      set({ configLoading: false, configReady: true }) // Ready with null = safe default
    }
  },

  updateConfig: async (section, values) => {
    try {
      const newConfig = await window.electronAPI.config.updateSection(section, values)
      set({ config: newConfig })
    } catch (error) {
      console.error('Failed to update config:', error)
    }
  },
}))
