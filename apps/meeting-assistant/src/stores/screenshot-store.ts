import { create } from 'zustand'
import type { Screenshot } from '../types/models'

interface ScreenshotState {
  screenshots: Screenshot[]
  loading: boolean
  // Actions
  fetchForSession: (sessionId: string) => Promise<void>
  capture: (sessionId: string) => Promise<Screenshot | null>
}

export const useScreenshotStore = create<ScreenshotState>((set) => ({
  screenshots: [],
  loading: false,

  fetchForSession: async (sessionId) => {
    set({ loading: true })
    try {
      const screenshots = await window.electronAPI.screenshot.listForSession(sessionId)
      set({ screenshots, loading: false })
    } catch (error) {
      console.error('[ScreenshotStore] Failed to fetch screenshots:', error)
      set({ loading: false })
    }
  },

  capture: async (sessionId) => {
    try {
      const screenshot = await window.electronAPI.screenshot.capture(sessionId)
      if (screenshot) {
        set((state) => ({ screenshots: [...state.screenshots, screenshot] }))
      }
      return screenshot
    } catch (error) {
      console.error('[ScreenshotStore] Failed to capture screenshot:', error)
      return null
    }
  },
}))

export function initScreenshotStore(): () => void {
  const unsub1 = window.electronAPI.screenshot.onCaptured((data) => {
    useScreenshotStore.setState((state) => {
      const exists = state.screenshots.some((s) => s.id === data.id)
      if (exists) return state
      return { screenshots: [...state.screenshots, data] }
    })
  })

  const unsub2 = window.electronAPI.screenshot.onAnalysisReady((data) => {
    useScreenshotStore.setState((state) => ({
      screenshots: state.screenshots.map((s) =>
        s.id === data.screenshotId ? { ...s, analysis: data.analysis } : s
      ),
    }))
  })

  return () => {
    unsub1()
    unsub2()
  }
}
