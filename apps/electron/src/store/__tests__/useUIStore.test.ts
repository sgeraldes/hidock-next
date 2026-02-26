/**
 * Comprehensive tests for useUIStore
 *
 * Tests cover all store functionality:
 * - Initial state verification
 * - Persist middleware: only sidebarOpen and qaLogsEnabled are persisted
 * - Sidebar actions: toggleSidebar, setSidebarOpen, setSidebarContent
 * - QA monitoring: setQaLogsEnabled
 * - Meeting selection: selectMeeting
 * - Output generation: setGeneratingOutput, setOutputContent, clearOutput
 * - Recordings view: setRecordingsCompactView
 * - Playback state: setCurrentlyPlaying, setPlaybackProgress, setIsPlaying
 * - Waveform state: setWaveformData, setWaveformLoading, setWaveformLoadingError, setWaveformLoadedFor
 * - Sentiment data: setSentimentData
 * - State isolation and edge cases
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/store/ui/useUIStore'

// Reset store before each test
beforeEach(() => {
  window.localStorage.clear()

  const store = useUIStore.getState()

  // Reset sidebar state
  store.setSidebarOpen(true)
  store.setSidebarContent('calendar')

  // Reset meeting/output
  store.selectMeeting(null)
  store.clearOutput()

  // Reset recordings view
  store.setRecordingsCompactView(true)

  // Reset playback
  store.setCurrentlyPlaying(null, null)
  store.setPlaybackProgress(0, 0)
  store.setIsPlaying(false)
  store.setWaveformData(null)
  store.setSentimentData(null)

  // Reset waveform loading
  store.setWaveformLoading(null)
  store.setWaveformLoadedFor(null)

  // Reset QA
  store.setQaLogsEnabled(false)
})

describe('useUIStore', () => {
  describe('Initial State', () => {
    it('has correct default state values after reset', () => {
      const state = useUIStore.getState()

      expect(state.sidebarOpen).toBe(true)
      expect(state.sidebarContent).toBe('calendar')
      expect(state.selectedMeetingId).toBeNull()
      expect(state.isGeneratingOutput).toBe(false)
      expect(state.outputContent).toBeNull()
      expect(state.recordingsCompactView).toBe(true)
      expect(state.currentlyPlayingId).toBeNull()
      expect(state.currentlyPlayingPath).toBeNull()
      expect(state.playbackCurrentTime).toBe(0)
      expect(state.playbackDuration).toBe(0)
      expect(state.isPlaying).toBe(false)
      expect(state.playbackWaveformData).toBeNull()
      expect(state.playbackSentimentData).toBeNull()
      expect(state.waveformLoadingId).toBeNull()
      expect(state.waveformLoadingError).toBeNull()
      expect(state.waveformLoadedForId).toBeNull()
      expect(state.qaLogsEnabled).toBe(false)
    })
  })

  describe('Persist Middleware', () => {
    it('persists sidebarOpen to localStorage', () => {
      const { setSidebarOpen } = useUIStore.getState()

      setSidebarOpen(false)

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.sidebarOpen).toBe(false)
    })

    it('persists qaLogsEnabled to localStorage', () => {
      const { setQaLogsEnabled } = useUIStore.getState()

      setQaLogsEnabled(true)

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.qaLogsEnabled).toBe(true)
    })

    it('does NOT persist playback state', () => {
      const store = useUIStore.getState()

      store.setCurrentlyPlaying('rec-1', '/path/to/file.wav')
      store.setPlaybackProgress(30, 120)
      store.setIsPlaying(true)

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.currentlyPlayingId).toBeUndefined()
      expect(stored.state.currentlyPlayingPath).toBeUndefined()
      expect(stored.state.playbackCurrentTime).toBeUndefined()
      expect(stored.state.playbackDuration).toBeUndefined()
      expect(stored.state.isPlaying).toBeUndefined()
    })

    it('does NOT persist waveform data', () => {
      const store = useUIStore.getState()

      store.setWaveformData(new Float32Array([0.1, 0.2, 0.3]))

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.playbackWaveformData).toBeUndefined()
    })

    it('does NOT persist waveform loading state', () => {
      const store = useUIStore.getState()

      store.setWaveformLoading('rec-1')

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.waveformLoadingId).toBeUndefined()
      expect(stored.state.waveformLoadingError).toBeUndefined()
      expect(stored.state.waveformLoadedForId).toBeUndefined()
    })

    it('does NOT persist selectedMeetingId', () => {
      const { selectMeeting } = useUIStore.getState()

      selectMeeting('meeting-123')

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.selectedMeetingId).toBeUndefined()
    })

    it('does NOT persist output state', () => {
      const store = useUIStore.getState()

      store.setGeneratingOutput(true)
      store.setOutputContent('Some generated content')

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.isGeneratingOutput).toBeUndefined()
      expect(stored.state.outputContent).toBeUndefined()
    })

    it('does NOT persist sidebarContent', () => {
      const { setSidebarContent } = useUIStore.getState()

      setSidebarContent('project')

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.sidebarContent).toBeUndefined()
    })

    it('does NOT persist sentimentData', () => {
      const { setSentimentData } = useUIStore.getState()

      setSentimentData([{ startTime: 0, endTime: 10, sentiment: 'positive' }])

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      expect(stored.state.playbackSentimentData).toBeUndefined()
    })

    it('only persists exactly sidebarOpen and qaLogsEnabled', () => {
      // Set various state values
      const store = useUIStore.getState()
      store.setSidebarOpen(false)
      store.setQaLogsEnabled(true)
      store.selectMeeting('meeting-1')
      store.setCurrentlyPlaying('rec-1', '/path')
      store.setIsPlaying(true)

      const stored = JSON.parse(window.localStorage.getItem('hidock-ui-store') || '{}')
      const persistedKeys = Object.keys(stored.state || {})

      expect(persistedKeys).toContain('sidebarOpen')
      expect(persistedKeys).toContain('qaLogsEnabled')
      expect(persistedKeys.length).toBe(2)
    })
  })

  describe('Sidebar Actions', () => {
    it('toggleSidebar toggles from open to closed', () => {
      const { toggleSidebar } = useUIStore.getState()

      expect(useUIStore.getState().sidebarOpen).toBe(true)
      toggleSidebar()
      expect(useUIStore.getState().sidebarOpen).toBe(false)
    })

    it('toggleSidebar toggles from closed to open', () => {
      const store = useUIStore.getState()

      store.setSidebarOpen(false)
      store.toggleSidebar()
      expect(useUIStore.getState().sidebarOpen).toBe(true)
    })

    it('toggleSidebar cycles correctly through multiple toggles', () => {
      const { toggleSidebar } = useUIStore.getState()

      toggleSidebar() // true -> false
      expect(useUIStore.getState().sidebarOpen).toBe(false)

      toggleSidebar() // false -> true
      expect(useUIStore.getState().sidebarOpen).toBe(true)

      toggleSidebar() // true -> false
      expect(useUIStore.getState().sidebarOpen).toBe(false)
    })

    it('setSidebarOpen sets to true', () => {
      const { setSidebarOpen } = useUIStore.getState()

      setSidebarOpen(false)
      setSidebarOpen(true)
      expect(useUIStore.getState().sidebarOpen).toBe(true)
    })

    it('setSidebarOpen sets to false', () => {
      const { setSidebarOpen } = useUIStore.getState()

      setSidebarOpen(false)
      expect(useUIStore.getState().sidebarOpen).toBe(false)
    })

    it('setSidebarContent sets content and opens sidebar', () => {
      const store = useUIStore.getState()

      store.setSidebarOpen(false)
      store.setSidebarContent('project')

      const state = useUIStore.getState()
      expect(state.sidebarContent).toBe('project')
      expect(state.sidebarOpen).toBe(true)
    })

    it('setSidebarContent accepts all valid content types', () => {
      const { setSidebarContent } = useUIStore.getState()
      const contentTypes = ['calendar', 'contact', 'project', 'chat', 'none'] as const

      contentTypes.forEach((content) => {
        setSidebarContent(content)
        expect(useUIStore.getState().sidebarContent).toBe(content)
      })
    })
  })

  describe('QA Monitoring', () => {
    it('setQaLogsEnabled enables QA logs', () => {
      const { setQaLogsEnabled } = useUIStore.getState()

      setQaLogsEnabled(true)
      expect(useUIStore.getState().qaLogsEnabled).toBe(true)
    })

    it('setQaLogsEnabled disables QA logs', () => {
      const { setQaLogsEnabled } = useUIStore.getState()

      setQaLogsEnabled(true)
      setQaLogsEnabled(false)
      expect(useUIStore.getState().qaLogsEnabled).toBe(false)
    })
  })

  describe('Meeting Selection', () => {
    it('selectMeeting sets meeting ID', () => {
      const { selectMeeting } = useUIStore.getState()

      selectMeeting('meeting-123')
      expect(useUIStore.getState().selectedMeetingId).toBe('meeting-123')
    })

    it('selectMeeting clears with null', () => {
      const { selectMeeting } = useUIStore.getState()

      selectMeeting('meeting-123')
      selectMeeting(null)
      expect(useUIStore.getState().selectedMeetingId).toBeNull()
    })
  })

  describe('Output Generation', () => {
    it('setGeneratingOutput sets generating flag', () => {
      const { setGeneratingOutput } = useUIStore.getState()

      setGeneratingOutput(true)
      expect(useUIStore.getState().isGeneratingOutput).toBe(true)
    })

    it('setOutputContent sets content', () => {
      const { setOutputContent } = useUIStore.getState()

      setOutputContent('Generated meeting minutes...')
      expect(useUIStore.getState().outputContent).toBe('Generated meeting minutes...')
    })

    it('setOutputContent clears with null', () => {
      const { setOutputContent } = useUIStore.getState()

      setOutputContent('Some content')
      setOutputContent(null)
      expect(useUIStore.getState().outputContent).toBeNull()
    })

    it('clearOutput resets both generating and content', () => {
      const store = useUIStore.getState()

      store.setGeneratingOutput(true)
      store.setOutputContent('Content here')

      useUIStore.getState().clearOutput()

      const state = useUIStore.getState()
      expect(state.isGeneratingOutput).toBe(false)
      expect(state.outputContent).toBeNull()
    })
  })

  describe('Recordings View', () => {
    it('setRecordingsCompactView sets to true', () => {
      const { setRecordingsCompactView } = useUIStore.getState()

      setRecordingsCompactView(false)
      setRecordingsCompactView(true)
      expect(useUIStore.getState().recordingsCompactView).toBe(true)
    })

    it('setRecordingsCompactView sets to false', () => {
      const { setRecordingsCompactView } = useUIStore.getState()

      setRecordingsCompactView(false)
      expect(useUIStore.getState().recordingsCompactView).toBe(false)
    })
  })

  describe('Playback State', () => {
    it('setCurrentlyPlaying sets recording and path', () => {
      const { setCurrentlyPlaying } = useUIStore.getState()

      setCurrentlyPlaying('rec-1', '/path/to/file.wav')

      const state = useUIStore.getState()
      expect(state.currentlyPlayingId).toBe('rec-1')
      expect(state.currentlyPlayingPath).toBe('/path/to/file.wav')
    })

    it('setCurrentlyPlaying clears with nulls', () => {
      const { setCurrentlyPlaying } = useUIStore.getState()

      setCurrentlyPlaying('rec-1', '/path/to/file.wav')
      setCurrentlyPlaying(null, null)

      const state = useUIStore.getState()
      expect(state.currentlyPlayingId).toBeNull()
      expect(state.currentlyPlayingPath).toBeNull()
    })

    it('setPlaybackProgress updates currentTime and duration', () => {
      const { setPlaybackProgress } = useUIStore.getState()

      setPlaybackProgress(45.5, 120.0)

      const state = useUIStore.getState()
      expect(state.playbackCurrentTime).toBe(45.5)
      expect(state.playbackDuration).toBe(120.0)
    })

    it('setPlaybackProgress handles zero values', () => {
      const { setPlaybackProgress } = useUIStore.getState()

      setPlaybackProgress(30, 60)
      setPlaybackProgress(0, 0)

      const state = useUIStore.getState()
      expect(state.playbackCurrentTime).toBe(0)
      expect(state.playbackDuration).toBe(0)
    })

    it('setIsPlaying sets playing state', () => {
      const { setIsPlaying } = useUIStore.getState()

      setIsPlaying(true)
      expect(useUIStore.getState().isPlaying).toBe(true)

      setIsPlaying(false)
      expect(useUIStore.getState().isPlaying).toBe(false)
    })

    it('setWaveformData sets Float32Array data', () => {
      const { setWaveformData } = useUIStore.getState()
      const data = new Float32Array([0.1, 0.5, -0.3, 0.8])

      setWaveformData(data)

      const state = useUIStore.getState()
      expect(state.playbackWaveformData).toBe(data)
      expect(state.playbackWaveformData!.length).toBe(4)
    })

    it('setWaveformData clears with null', () => {
      const { setWaveformData } = useUIStore.getState()

      setWaveformData(new Float32Array([0.1, 0.2]))
      setWaveformData(null)

      expect(useUIStore.getState().playbackWaveformData).toBeNull()
    })

    it('setSentimentData sets sentiment segments', () => {
      const { setSentimentData } = useUIStore.getState()
      const segments = [
        { startTime: 0, endTime: 30, sentiment: 'positive' as const },
        { startTime: 30, endTime: 60, sentiment: 'negative' as const },
        { startTime: 60, endTime: 90, sentiment: 'neutral' as const }
      ]

      setSentimentData(segments)

      const state = useUIStore.getState()
      expect(state.playbackSentimentData).toEqual(segments)
      expect(state.playbackSentimentData!.length).toBe(3)
    })

    it('setSentimentData clears with null', () => {
      const { setSentimentData } = useUIStore.getState()

      setSentimentData([{ startTime: 0, endTime: 10, sentiment: 'positive' }])
      setSentimentData(null)

      expect(useUIStore.getState().playbackSentimentData).toBeNull()
    })
  })

  describe('Waveform Loading State', () => {
    it('setWaveformLoading sets loading ID and clears error', () => {
      const { setWaveformLoading } = useUIStore.getState()

      setWaveformLoading('rec-1')

      const state = useUIStore.getState()
      expect(state.waveformLoadingId).toBe('rec-1')
      expect(state.waveformLoadingError).toBeNull()
    })

    it('setWaveformLoading clears with null', () => {
      const { setWaveformLoading } = useUIStore.getState()

      setWaveformLoading('rec-1')
      setWaveformLoading(null)

      expect(useUIStore.getState().waveformLoadingId).toBeNull()
    })

    it('setWaveformLoadingError clears loading and sets error', () => {
      const store = useUIStore.getState()

      store.setWaveformLoading('rec-1')
      store.setWaveformLoadingError('rec-1', 'File not found')

      const state = useUIStore.getState()
      expect(state.waveformLoadingId).toBeNull()
      expect(state.waveformLoadingError).toBe('File not found')
    })

    it('setWaveformLoadedFor clears loading and error, sets loaded ID', () => {
      const store = useUIStore.getState()

      store.setWaveformLoading('rec-1')
      store.setWaveformLoadedFor('rec-1')

      const state = useUIStore.getState()
      expect(state.waveformLoadingId).toBeNull()
      expect(state.waveformLoadingError).toBeNull()
      expect(state.waveformLoadedForId).toBe('rec-1')
    })

    it('setWaveformLoadedFor clears with null', () => {
      const store = useUIStore.getState()

      store.setWaveformLoadedFor('rec-1')
      store.setWaveformLoadedFor(null)

      expect(useUIStore.getState().waveformLoadedForId).toBeNull()
    })
  })

  describe('State Isolation', () => {
    it('sidebar changes do not affect playback', () => {
      const store = useUIStore.getState()

      store.setCurrentlyPlaying('rec-1', '/path')
      store.setIsPlaying(true)

      store.toggleSidebar()
      store.setSidebarContent('project')

      const state = useUIStore.getState()
      expect(state.currentlyPlayingId).toBe('rec-1')
      expect(state.isPlaying).toBe(true)
    })

    it('playback changes do not affect sidebar', () => {
      const store = useUIStore.getState()

      store.setSidebarContent('chat')
      store.setSidebarOpen(true)

      store.setCurrentlyPlaying('rec-1', '/path')
      store.setIsPlaying(true)
      store.setPlaybackProgress(50, 100)

      const state = useUIStore.getState()
      expect(state.sidebarContent).toBe('chat')
      expect(state.sidebarOpen).toBe(true)
    })

    it('output changes do not affect meeting selection', () => {
      const store = useUIStore.getState()

      store.selectMeeting('meeting-1')
      store.setGeneratingOutput(true)
      store.setOutputContent('Content')
      store.clearOutput()

      expect(useUIStore.getState().selectedMeetingId).toBe('meeting-1')
    })

    it('waveform loading state is independent of playback state', () => {
      const store = useUIStore.getState()

      store.setCurrentlyPlaying('rec-1', '/path')
      store.setIsPlaying(true)
      store.setWaveformLoading('rec-2')

      const state = useUIStore.getState()
      expect(state.currentlyPlayingId).toBe('rec-1')
      expect(state.waveformLoadingId).toBe('rec-2')
    })
  })

  describe('Edge Cases', () => {
    it('handles rapid sidebar toggles', () => {
      const { toggleSidebar } = useUIStore.getState()

      for (let i = 0; i < 100; i++) {
        toggleSidebar()
      }

      // 100 toggles from true = back to true (even count)
      expect(useUIStore.getState().sidebarOpen).toBe(true)
    })

    it('handles playback progress with fractional values', () => {
      const { setPlaybackProgress } = useUIStore.getState()

      setPlaybackProgress(45.123456, 120.654321)

      const state = useUIStore.getState()
      expect(state.playbackCurrentTime).toBe(45.123456)
      expect(state.playbackDuration).toBe(120.654321)
    })

    it('maintains state integrity after multiple operations', () => {
      const store = useUIStore.getState()

      // Perform many operations across different state areas
      store.setSidebarContent('project')
      store.selectMeeting('meeting-1')
      store.setGeneratingOutput(true)
      store.setOutputContent('Generated content')
      store.setCurrentlyPlaying('rec-1', '/path/to/audio.wav')
      store.setPlaybackProgress(30, 90)
      store.setIsPlaying(true)
      store.setWaveformData(new Float32Array([0.1, 0.2]))
      store.setSentimentData([{ startTime: 0, endTime: 10, sentiment: 'positive' }])
      store.setWaveformLoadedFor('rec-1')
      store.setQaLogsEnabled(true)
      store.setRecordingsCompactView(false)

      // Verify all state
      const finalState = useUIStore.getState()
      expect(finalState.sidebarContent).toBe('project')
      expect(finalState.sidebarOpen).toBe(true)
      expect(finalState.selectedMeetingId).toBe('meeting-1')
      expect(finalState.isGeneratingOutput).toBe(true)
      expect(finalState.outputContent).toBe('Generated content')
      expect(finalState.currentlyPlayingId).toBe('rec-1')
      expect(finalState.currentlyPlayingPath).toBe('/path/to/audio.wav')
      expect(finalState.playbackCurrentTime).toBe(30)
      expect(finalState.playbackDuration).toBe(90)
      expect(finalState.isPlaying).toBe(true)
      expect(finalState.playbackWaveformData).not.toBeNull()
      expect(finalState.playbackSentimentData).not.toBeNull()
      expect(finalState.waveformLoadedForId).toBe('rec-1')
      expect(finalState.qaLogsEnabled).toBe(true)
      expect(finalState.recordingsCompactView).toBe(false)
    })
  })
})
