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
  }
}))

// Convenience hook for sidebar state
export const useSidebar = () => {
  return useUIStore((state) => ({
    isOpen: state.sidebarOpen,
    content: state.sidebarContent,
    toggle: state.toggleSidebar,
    setContent: state.setSidebarContent,
    setOpen: state.setSidebarOpen
  }))
}

// Convenience hook for meeting selection
export const useSelectedMeeting = () => {
  return useUIStore((state) => ({
    meetingId: state.selectedMeetingId,
    select: state.selectMeeting
  }))
}

// Convenience hook for output generation
export const useOutputGeneration = () => {
  return useUIStore((state) => ({
    isGenerating: state.isGeneratingOutput,
    content: state.outputContent,
    setGenerating: state.setGeneratingOutput,
    setContent: state.setOutputContent,
    clear: state.clearOutput
  }))
}
