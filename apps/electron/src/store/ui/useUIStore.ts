/**
 * UI Store
 *
 * Manages UI state including sidebar, selected meeting, and output generation.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UIStore, SidebarContent } from '@/types/stores'

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
  // State
  sidebarOpen: true,
  sidebarContent: 'calendar',
  selectedMeetingId: null,

  // AI assistant placement — defaults to the floating chat-bubble experience.
  chatPlacement: 'floating',
  chatPosition: 'right',
  chatOpen: false,
  chatEmbeddedCollapsed: false,

  isGeneratingOutput: false,
  outputContent: null,

  // Recordings page view preference (persists across navigation)
  recordingsCompactView: true, // Default to list view (compact)

  // Operations dock chrome
  operationsDockCollapsed: false,
  operationsOverlayOpen: false,
  activityLogExpanded: false,

  // Playback state (managed by OperationController)
  currentlyPlayingId: null,
  currentlyPlayingPath: null,
  playbackCurrentTime: 0,
  playbackDuration: 0,
  isPlaying: false,
  playbackWaveformData: null,
  playbackSentimentData: null,

  // Waveform loading state
  waveformLoadingId: null,
  waveformLoadingError: null,
  waveformErrorForId: null,
  waveformLoadedForId: null,

  // QA monitoring toggle
  qaLogsEnabled: false,

  // Auto-capture screenshots from clipboard — defaults OFF (opt-in background poll).
  autoCaptureScreenshots: false,

  // Theme preference — defaults to following the OS.
  theme: 'system',

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

  // AI assistant placement actions. Switching to embedded closes the floating
  // overlay; switching to floating leaves it closed until the user opens it.
  setChatPlacement: (placement) => {
    set(placement === 'embedded' ? { chatPlacement: placement, chatOpen: false } : { chatPlacement: placement })
  },

  setChatPosition: (position) => {
    set({ chatPosition: position })
  },

  setChatOpen: (open) => {
    set({ chatOpen: open })
  },

  toggleChatOpen: () => {
    set((state) => ({ chatOpen: !state.chatOpen }))
  },

  setChatEmbeddedCollapsed: (collapsed) => {
    set({ chatEmbeddedCollapsed: collapsed })
  },

  toggleChatEmbeddedCollapsed: () => {
    set((state) => ({ chatEmbeddedCollapsed: !state.chatEmbeddedCollapsed }))
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

  // Recordings view actions
  setRecordingsCompactView: (compact: boolean) => {
    set({ recordingsCompactView: compact })
  },

  // Operations dock actions
  toggleOperationsDock: () => {
    set((state) => ({ operationsDockCollapsed: !state.operationsDockCollapsed }))
  },

  setOperationsDockCollapsed: (collapsed: boolean) => {
    set({ operationsDockCollapsed: collapsed })
  },

  openOperationsOverlay: () => {
    set({ operationsOverlayOpen: true })
  },

  closeOperationsOverlay: () => {
    set({ operationsOverlayOpen: false })
  },

  toggleActivityLog: () => {
    set((state) => ({ activityLogExpanded: !state.activityLogExpanded }))
  },

  setActivityLogExpanded: (expanded: boolean) => {
    set({ activityLogExpanded: expanded })
  },

  // Playback actions (called by OperationController)
  setCurrentlyPlaying: (recordingId: string | null, filePath: string | null) => {
    set({ currentlyPlayingId: recordingId, currentlyPlayingPath: filePath })
  },

  setPlaybackProgress: (currentTime: number, duration: number) => {
    set({ playbackCurrentTime: currentTime, playbackDuration: duration })
  },

  setIsPlaying: (playing: boolean) => {
    set({ isPlaying: playing })
  },

  setWaveformData: (waveformData: Float32Array | null) => {
    set({ playbackWaveformData: waveformData })
  },

  setSentimentData: (sentimentData) => {
    set({ playbackSentimentData: sentimentData })
  },

  // Waveform loading actions
  setWaveformLoading: (recordingId: string | null) => {
    set({
      waveformLoadingId: recordingId,
      waveformLoadingError: null,
      waveformErrorForId: null
    })
  },

  setWaveformLoadingError: (recordingId: string | null, error: string | null) => {
    set({
      waveformLoadingId: null,
      waveformLoadingError: error,
      waveformErrorForId: recordingId
    })
  },

  setWaveformLoadedFor: (recordingId: string | null) => {
    set({
      waveformLoadingId: null,
      waveformLoadingError: null,
      waveformErrorForId: null,
      waveformLoadedForId: recordingId
    })
  },

  // QA monitoring actions
  setQaLogsEnabled: (enabled: boolean) => {
    set({ qaLogsEnabled: enabled })
  },

  // Clipboard auto-capture toggle
  setAutoCaptureScreenshots: (enabled: boolean) => {
    set({ autoCaptureScreenshots: enabled })
  },

  // Theme actions — the applied `dark` class is reconciled by useTheme().
  setTheme: (theme) => {
    set({ theme })
  },
    }),
    {
      name: 'hidock-ui-store',
      storage: createJSONStorage(() => localStorage),
      // Only persist user preferences, NOT transient playback/waveform state
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        // AI assistant placement preferences (honored on load). chatOpen is
        // intentionally NOT persisted — the overlay always starts closed.
        chatPlacement: state.chatPlacement,
        chatPosition: state.chatPosition,
        chatEmbeddedCollapsed: state.chatEmbeddedCollapsed,
        qaLogsEnabled: state.qaLogsEnabled,
        autoCaptureScreenshots: state.autoCaptureScreenshots, // persisted: user preference
        theme: state.theme, // persisted: user preference (also read pre-paint in main.tsx)
        operationsDockCollapsed: state.operationsDockCollapsed, // persisted: dock chrome pref
        activityLogExpanded: state.activityLogExpanded, // persisted: dock chrome pref
        // operationsOverlayOpen intentionally not persisted — transient overlay
        // recordingsCompactView NOT persisted here - useLibraryStore.viewMode is the single source of truth (LB-13)
        // currentlyPlayingId intentionally not persisted - transient playback
        // currentlyPlayingPath intentionally not persisted - transient playback
        // playbackCurrentTime intentionally not persisted - transient
        // playbackDuration intentionally not persisted - transient
        // isPlaying intentionally not persisted - transient
        // playbackWaveformData intentionally not persisted - transient (Float32Array)
        // playbackSentimentData intentionally not persisted - transient
        // waveformLoadingId intentionally not persisted - transient
        // waveformLoadingError intentionally not persisted - transient
        // waveformLoadedForId intentionally not persisted - transient
        // selectedMeetingId intentionally not persisted - transient
        // isGeneratingOutput intentionally not persisted - transient
        // outputContent intentionally not persisted - transient
        // sidebarContent intentionally not persisted - start fresh
      })
    }
  )
)

// ---- Granular Selector Exports (Performance Optimized) ----
// Following spec-002 and architecture review requirements

import { useShallow } from 'zustand/react/shallow'

// ✅ Scalar selectors - no wrapper needed (Object.is works)
export const useCurrentlyPlayingId = () => useUIStore((s) => s.currentlyPlayingId)
export const usePlaybackCurrentTime = () => useUIStore((s) => s.playbackCurrentTime)
export const usePlaybackDuration = () => useUIStore((s) => s.playbackDuration)
export const useIsPlaying = () => useUIStore((s) => s.isPlaying)
export const useWaveformLoadingId = () => useUIStore((s) => s.waveformLoadingId)
export const useWaveformLoadedForId = () => useUIStore((s) => s.waveformLoadedForId)
export const useQaLogsEnabled = () => useUIStore((s) => s.qaLogsEnabled)
export const useAutoCaptureScreenshots = () => useUIStore((s) => s.autoCaptureScreenshots)

// AI assistant placement selectors (scalar — Object.is is sufficient)
export const useChatPlacement = () => useUIStore((s) => s.chatPlacement)
export const useChatPosition = () => useUIStore((s) => s.chatPosition)
export const useChatOpen = () => useUIStore((s) => s.chatOpen)
export const useChatEmbeddedCollapsed = () => useUIStore((s) => s.chatEmbeddedCollapsed)
export const useThemePreference = () => useUIStore((s) => s.theme)
export const useOperationsDockCollapsed = () => useUIStore((s) => s.operationsDockCollapsed)
export const useOperationsOverlayOpen = () => useUIStore((s) => s.operationsOverlayOpen)
export const useActivityLogExpanded = () => useUIStore((s) => s.activityLogExpanded)

// ✅ Single reference selectors - no wrapper needed
export const usePlaybackWaveformData = () => useUIStore((s) => s.playbackWaveformData)
export const usePlaybackSentimentData = () => useUIStore((s) => s.playbackSentimentData)

// ✅ Derived object selectors - MUST use useShallow to prevent infinite re-renders
export const usePlaybackActions = () =>
  useUIStore(useShallow((s) => ({
    setCurrentlyPlaying: s.setCurrentlyPlaying,
    setPlaybackProgress: s.setPlaybackProgress,
    setIsPlaying: s.setIsPlaying,
  })))

export const useWaveformActions = () =>
  useUIStore(useShallow((s) => ({
    setWaveformData: s.setWaveformData,
    setWaveformLoading: s.setWaveformLoading,
    setWaveformLoadingError: s.setWaveformLoadingError,
    setWaveformLoadedFor: s.setWaveformLoadedFor,
  })))

export const usePlaybackState = () =>
  useUIStore(useShallow((s) => ({
    currentlyPlayingId: s.currentlyPlayingId,
    currentlyPlayingPath: s.currentlyPlayingPath,
    currentTime: s.playbackCurrentTime,
    duration: s.playbackDuration,
    isPlaying: s.isPlaying,
  })))

// Note: When selecting multiple values from the store, use individual selectors
// in your component to avoid infinite re-render issues. For example:
//   const isGenerating = useUIStore((state) => state.isGeneratingOutput)
//   const content = useUIStore((state) => state.outputContent)
//
// Combining selectors into objects can cause infinite loops because a new object
// is created on each render. Use `useShallow` from 'zustand/react/shallow' if you
// need to select multiple values at once.
