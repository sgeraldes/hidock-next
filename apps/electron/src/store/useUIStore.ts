/**
 * UI Store
 *
 * Manages UI state including sidebar, selected meeting, and output generation.
 */

import { create } from 'zustand'
import type { UIStore, SidebarContent } from '@/types/stores'

export const useUIStore = create<UIStore>((set) => ({
  // State
  sidebarOpen: true,
  sidebarContent: 'calendar',
  selectedMeetingId: null,
  isGeneratingOutput: false,
  outputContent: null,

  // Playback state (managed by OperationController)
  currentlyPlayingId: null,
  currentlyPlayingPath: null,
  playbackCurrentTime: 0,
  playbackDuration: 0,

  // Actions
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }))
  },

  setSidebarOpen: (open: boolean) => {
    set({ sidebarOpen: open })
  },

  setSidebarContent: (content: SidebarContent) => {
    set({ sidebarContent: content, sidebarOpen: true })
  },

  selectMeeting: (id: string | null) => {
    set({ selectedMeetingId: id })
  },

  setGeneratingOutput: (generating: boolean) => {
    set({ isGeneratingOutput: generating })
  },

  setOutputContent: (content: string | null) => {
    set({ outputContent: content })
  },

  clearOutput: () => {
    set({ outputContent: null, isGeneratingOutput: false })
  },

  // Playback actions (called by OperationController)
  setCurrentlyPlaying: (recordingId: string | null, filePath: string | null) => {
    set({ currentlyPlayingId: recordingId, currentlyPlayingPath: filePath })
  },

  setPlaybackProgress: (currentTime: number, duration: number) => {
    set({ playbackCurrentTime: currentTime, playbackDuration: duration })
  }
}))

// Note: When selecting multiple values from the store, use individual selectors
// in your component to avoid infinite re-render issues. For example:
//   const isGenerating = useUIStore((state) => state.isGeneratingOutput)
//   const content = useUIStore((state) => state.outputContent)
//
// Combining selectors into objects can cause infinite loops because a new object
// is created on each render. Use `useShallow` from 'zustand/react/shallow' if you
// need to select multiple values at once.
