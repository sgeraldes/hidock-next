import { create } from 'zustand'

interface AppState {
  activeSessionId: string | null
  theme: 'dark' | 'light'
  isRecording: boolean
  sidebarCollapsed: boolean
  // Actions
  setActiveSession: (id: string | null) => void
  setTheme: (theme: 'dark' | 'light') => void
  toggleTheme: () => void
  setIsRecording: (recording: boolean) => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeSessionId: null,
  theme: 'dark',
  isRecording: false,
  sidebarCollapsed: false,
  setActiveSession: (id) => set({ activeSessionId: id }),
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  setIsRecording: (recording) => set({ isRecording: recording }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}))

type RecordingStateData = { isRecording: boolean; sessionId: string | null }
type ElectronWithRecordingState = {
  onRecordingState?: (cb: (data: RecordingStateData) => void) => () => void
}

/**
 * Initialise the app store IPC listeners. Call once on app startup.
 * Returns an unsubscribe function to clean up.
 */
export function initAppStore(): () => void {
  const api = (window as unknown as { electronAPI?: ElectronWithRecordingState }).electronAPI
  if (!api?.onRecordingState) return () => {}

  const unsub = api.onRecordingState((data) => {
    useAppStore.setState({
      isRecording: data.isRecording,
      activeSessionId: data.sessionId,
    })
  })

  return unsub
}
