import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, RefreshCw, Play, X, LayoutGrid, Square, CheckSquare, FileText, Trash2, List, FileAudio, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { cn, formatTime, isToday, formatDuration } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { Meeting, Recording } from '@/types'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RecordingLinkDialog } from '@/components/RecordingLinkDialog'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import { UnifiedRecording, DeviceOnlyRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { AudioPlayer } from '@/components/AudioPlayer'
import { useAudioControls } from '@/components/OperationController'
import { useUIStore } from '@/store/useUIStore'

// Extracted calendar components
import { CalendarHeader, CalendarStatsBar, StatusIcon, RecordingTooltipContent, MeetingOverlayTooltipContent, MeetingTooltipContent } from '@/components/calendar'
import type { LocationFilter, SortOption, RecordingStats } from '@/components/calendar'

// Extracted calendar utilities
import {
  type CalendarViewType,
  type CalendarRecording,
  type CalendarMeetingOverlay,
  type CalendarMeeting,
  type DurationMatch,
  HOUR_HEIGHT,
  START_HOUR,
  END_HOUR,
  HOURS,
  getWeekDates,
  getWorkweekDates,
  getDayDates,
  getMonthDates,
  matchRecordingsToMeetings,
  createPlaceholderMeetings,
  buildCalendarRecordings,
  formatDurationStr,
  groupByDay,
} from '@/lib/calendar-utils'

// Helper functions for date/time formatting in list views
function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatShortTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function Calendar() {
  const navigate = useNavigate()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const {
    meetings,
    currentDate,
    meetingsLoading,
    navigateWeek,
    navigateMonth,
    goToToday,
    setCurrentDate,
    setCalendarView,
    loadMeetings,
    lastCalendarSync: lastSync,
    syncCalendar,
    calendarSyncing,
    config,
    loadConfig,
    updateConfig,
    // Download queue from global store (persists across navigation)
    downloadQueue,
    addToDownloadQueue,
    updateDownloadProgress,
    removeFromDownloadQueue,
    setDeviceSyncState,
  } = useAppStore()

  // Get unified recordings (device + local)
  const { recordings: unifiedRecordings, loading: recordingsLoading, refresh: refreshRecordings, deviceConnected, stats } = useUnifiedRecordings()

  // State from config (with defaults)
  const [calendarView, setCalendarViewLocal] = useState<CalendarViewType>('week')
  const [hideEmptyMeetings, setHideEmptyMeetings] = useState(true)
  const [showListView, setShowListView] = useState(false)
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true)

  // Playback state from global store
  const currentlyPlayingId = useUIStore((state) => state.currentlyPlayingId)
  const audioControls = useAudioControls()
  // Note: downloadingIds now comes from global downloadQueue store

  // Filter and sort state (types imported from @/components/calendar)
  type ViewMode = 'list' | 'compact' | 'cards'
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all')
  const [sortBy, setSortBy] = useState<SortOption>('date-desc')
  const [viewMode, setViewMode] = useState<ViewMode>('compact')

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState<string | null>(null)

  // State for recording link dialog
  const [linkDialogRecording, setLinkDialogRecording] = useState<
    Pick<Recording, 'id' | 'filename' | 'date_recorded' | 'duration_seconds'> | null
  >(null)

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Sync state with config when it loads
  useEffect(() => {
    if (config?.ui) {
      setCalendarViewLocal(config.ui.calendarView || 'week')
      setHideEmptyMeetings(config.ui.hideEmptyMeetings ?? true)
      setShowListView(config.ui.showListView ?? false)
    }
    if (config?.calendar) {
      setAutoSyncEnabled(config.calendar.syncEnabled)
    }
  }, [config])

  // Load meetings when date or view changes
  useEffect(() => {
    let startDate: string
    let endDate: string

    if (calendarView === 'month') {
      const dates = getMonthDates(currentDate)
      startDate = dates[0].toISOString()
      const lastDate = new Date(dates[dates.length - 1])
      lastDate.setHours(23, 59, 59, 999)
      endDate = lastDate.toISOString()
    } else if (calendarView === 'day') {
      const dayStart = new Date(currentDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(currentDate)
      dayEnd.setHours(23, 59, 59, 999)
      startDate = dayStart.toISOString()
      endDate = dayEnd.toISOString()
    } else if (calendarView === 'workweek') {
      const dates = getWorkweekDates(currentDate)
      startDate = dates[0].toISOString()
      const lastDate = new Date(dates[dates.length - 1])
      lastDate.setHours(23, 59, 59, 999)
      endDate = lastDate.toISOString()
    } else {
      const dates = getWeekDates(currentDate)
      startDate = dates[0].toISOString()
      const lastDate = new Date(dates[6])
      lastDate.setHours(23, 59, 59, 999)
      endDate = lastDate.toISOString()
    }

    loadMeetings(startDate, endDate)
  }, [currentDate, calendarView, loadMeetings])

  // Scroll to current hour on mount
  useEffect(() => {
    if (scrollContainerRef.current && !showListView) {
      const now = new Date()
      const currentHour = now.getHours()
      const scrollPosition = Math.max(0, (currentHour - START_HOUR - 1) * HOUR_HEIGHT)
      scrollContainerRef.current.scrollTop = scrollPosition
    }
  }, [showListView])

  // Get dates for current view
  const viewDates = useMemo(() => {
    switch (calendarView) {
      case 'day':
        return getDayDates(currentDate)
      case 'workweek':
        return getWorkweekDates(currentDate)
      case 'week':
        return getWeekDates(currentDate)
      case 'month':
        return getMonthDates(currentDate)
    }
  }, [currentDate, calendarView])

  const monthDates = useMemo(() => getMonthDates(currentDate), [currentDate])

  // Office hours from config
  const officeHoursStart = config?.ui?.officeHoursStart ?? 9
  const officeHoursEnd = config?.ui?.officeHoursEnd ?? 18
  const workDays = config?.ui?.workDays ?? [1, 2, 3, 4, 5]

  // Check if a date is a work day
  const isWorkDay = (date: Date) => workDays.includes(date.getDay())

  // Check if an hour is within office hours
  const isOfficeHour = (hour: number) => hour >= officeHoursStart && hour < officeHoursEnd

  // Match recordings to meetings and create placeholders for orphan recordings
  const { calendarMeetings, orphanRecordings } = useMemo(() => {
    return matchRecordingsToMeetings(meetings, unifiedRecordings)
  }, [meetings, unifiedRecordings])

  // Create placeholder meetings from orphan recordings
  const placeholderMeetings = useMemo(() => {
    return createPlaceholderMeetings(orphanRecordings)
  }, [orphanRecordings])

  // Combine real meetings with placeholders (based on toggle)
  const allMeetings = useMemo(() => {
    if (hideEmptyMeetings) {
      // Only show meetings that have recordings + orphan recordings as placeholders
      const meetingsWithRecordings = calendarMeetings.filter(m => m.hasRecording)
      return [...meetingsWithRecordings, ...placeholderMeetings]
    }
    // Show all calendar meetings (with and without recordings) + orphan recordings as placeholders
    return [...calendarMeetings, ...placeholderMeetings]
  }, [calendarMeetings, placeholderMeetings, hideEmptyMeetings])

  // Group meetings by day (for day/workweek/week views)
  const meetingsByDay = useMemo(() => {
    const grouped = groupByDay(
      allMeetings,
      (m) => new Date(m.start_time),
      viewDates
    )
    // Sort meetings by start time within each day
    for (const key in grouped) {
      grouped[key].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    }
    return grouped
  }, [allMeetings, viewDates])

  // Group meetings for month view
  const meetingsByMonth = useMemo(() => {
    const grouped = groupByDay(
      allMeetings,
      (m) => new Date(m.start_time),
      monthDates
    )
    // Sort meetings by start time within each day
    for (const key in grouped) {
      grouped[key].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    }
    return grouped
  }, [allMeetings, monthDates])

  // ===== RECORDING-CENTRIC DATA =====
  // Build recording-centric calendar data (recordings as PRIMARY, meetings as metadata)
  const { calendarRecordings, meetingOverlays } = useMemo(() => {
    return buildCalendarRecordings(unifiedRecordings, meetings)
  }, [unifiedRecordings, meetings])

  // Group recordings by day (for day/workweek/week views)
  const recordingsByDay = useMemo(() => {
    const grouped = groupByDay(
      calendarRecordings,
      (r) => r.startTime,
      viewDates
    )
    // Sort recordings by start time within each day
    for (const key in grouped) {
      grouped[key].sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    }
    return grouped
  }, [calendarRecordings, viewDates])

  // Group meeting overlays by day (only meetings WITHOUT recordings, shown as dashed)
  const meetingOverlaysByDay = useMemo(() => {
    // Only include meetings that have NO recordings (they are shown as dashed overlays)
    const meetingsWithoutRecordings = hideEmptyMeetings ? [] : meetingOverlays.filter(m => !m.hasRecording)
    const grouped = groupByDay(
      meetingsWithoutRecordings,
      (m) => m.startTime,
      viewDates
    )
    // Sort by start time within each day
    for (const key in grouped) {
      grouped[key].sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    }
    return grouped
  }, [meetingOverlays, viewDates, hideEmptyMeetings])

  const handleMeetingClick = (meeting: Meeting) => {
    navigate(`/meeting/${meeting.id}`)
  }

  // Handle recording click - navigate to recording details or open link dialog
  const handleRecordingClick = (recording: CalendarRecording) => {
    if (recording.linkedMeeting) {
      navigate(`/meeting/${recording.linkedMeeting.id}`)
    } else {
      // Open link dialog for orphan recordings
      setLinkDialogRecording({
        id: recording.id,
        filename: recording.filename,
        date_recorded: recording.startTime.toISOString(),
        duration_seconds: recording.durationSeconds
      })
    }
  }

  // Calculate recording position and height (RECORDING-CENTRIC)
  const getRecordingStyle = (recording: CalendarRecording) => {
    const startHour = recording.startTime.getHours() + recording.startTime.getMinutes() / 60
    const endHour = recording.endTime.getHours() + recording.endTime.getMinutes() / 60

    const top = Math.max(0, (startHour - START_HOUR) * HOUR_HEIGHT)
    const height = Math.max(20, (endHour - startHour) * HOUR_HEIGHT - 2)

    return { top, height }
  }

  // Calculate meeting overlay position (for dashed meeting blocks)
  const getMeetingOverlayStyle = (meeting: CalendarMeetingOverlay) => {
    const startHour = meeting.startTime.getHours() + meeting.startTime.getMinutes() / 60
    const endHour = meeting.endTime.getHours() + meeting.endTime.getMinutes() / 60

    const top = Math.max(0, (startHour - START_HOUR) * HOUR_HEIGHT)
    const height = Math.max(20, (endHour - startHour) * HOUR_HEIGHT - 2)

    return { top, height }
  }

  // Calculate meeting position and height (legacy - for backwards compat)
  const getMeetingStyle = (meeting: Meeting) => {
    const start = new Date(meeting.start_time)
    const end = new Date(meeting.end_time)

    const startHour = start.getHours() + start.getMinutes() / 60
    const endHour = end.getHours() + end.getMinutes() / 60

    const top = Math.max(0, (startHour - START_HOUR) * HOUR_HEIGHT)
    const height = Math.max(20, (endHour - startHour) * HOUR_HEIGHT - 2)

    return { top, height }
  }

  const monthYear = currentDate instanceof Date 
    ? currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : ''

  // Format last sync time (memoized)
  const formatLastSync = useCallback(() => {
    if (!lastSync) return ''
    const syncDate = new Date(lastSync)
    return syncDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }, [lastSync])

  // Handle sync button click
  const handleSync = useCallback(async () => {
    console.log('[Calendar] Clearing cache and resyncing...')
    try {
      const result = await window.electronAPI.calendar.clearAndSync()
      console.log('[Calendar] Clear and sync result:', result)
      // Reload meetings for current view
      const endDate = new Date(viewDates[viewDates.length - 1])
      endDate.setHours(23, 59, 59, 999)
      await loadMeetings(viewDates[0].toISOString(), endDate.toISOString())
    } catch (err) {
      console.error('[Calendar] Clear and sync failed:', err)
    }
  }, [viewDates, loadMeetings])

  // Handle navigation (memoized)
  const handleNavigatePrev = useCallback(() => {
    if (calendarView === 'day') {
      const newDate = new Date(currentDate)
      newDate.setDate(newDate.getDate() - 1)
      setCurrentDate(newDate)
    } else if (calendarView === 'month') {
      navigateMonth('prev')
    } else {
      navigateWeek('prev')
    }
  }, [calendarView, navigateMonth, navigateWeek, currentDate, setCurrentDate])

  const handleNavigateNext = useCallback(() => {
    if (calendarView === 'day') {
      const newDate = new Date(currentDate)
      newDate.setDate(newDate.getDate() + 1)
      setCurrentDate(newDate)
    } else if (calendarView === 'month') {
      navigateMonth('next')
    } else {
      navigateWeek('next')
    }
  }, [calendarView, navigateMonth, navigateWeek, currentDate, setCurrentDate])

  // Handle view changes with config persistence (memoized)
  const handleCalendarViewChange = useCallback(async (view: CalendarViewType) => {
    setCalendarViewLocal(view)
    setCalendarView(view)
    try {
      await updateConfig('ui', { calendarView: view })
    } catch (e) {
      console.error('Failed to save view preference:', e)
    }
  }, [setCalendarView, updateConfig])

  const handleHideEmptyToggle = useCallback(async (hide: boolean) => {
    setHideEmptyMeetings(hide)
    try {
      await updateConfig('ui', { hideEmptyMeetings: hide })
    } catch (e) {
      console.error('Failed to save preference:', e)
    }
  }, [updateConfig])

  const handleViewToggle = useCallback(async (listView: boolean) => {
    setShowListView(listView)
    try {
      await updateConfig('ui', { showListView: listView })
    } catch (e) {
      console.error('Failed to save preference:', e)
    }
  }, [updateConfig])

  const handleAutoSyncToggle = useCallback(async (enabled: boolean) => {
    setAutoSyncEnabled(enabled)
    try {
      await window.electronAPI.calendar.toggleAutoSync(enabled)
      loadConfig()
    } catch (error) {
      console.error('Failed to toggle auto-sync:', error)
      setAutoSyncEnabled(!enabled)
    }
  }, [loadConfig])

  // Download recording from device (memoized) - supports multiple concurrent downloads
  // Uses global download queue for persistence across page navigation
  const handleDownload = useCallback(async (recording: UnifiedRecording) => {
    if (!isDeviceOnly(recording)) return

    const deviceService = getHiDockDeviceService()
    if (!deviceService.isConnected()) return

    // Check if already downloading using global store
    if (downloadQueue.has(recording.id)) return

    // Add to global download queue
    addToDownloadQueue(recording.id, recording.deviceFilename, recording.size)

    try {
      console.log(`[Calendar] Starting download: ${recording.deviceFilename} (${recording.size} bytes)`)
      const success = await deviceService.downloadRecordingToFile(
        recording.deviceFilename,
        recording.size,
        '',
        // Progress callback to update global store
        (received) => {
          const percent = Math.round((received / recording.size) * 100)
          updateDownloadProgress(recording.id, percent)
        },
        recording.dateRecorded // Pass the original recording date from device
      )
      console.log(`[Calendar] Download ${success ? 'succeeded' : 'FAILED'}: ${recording.deviceFilename}`)
      if (success) {
        await refreshRecordings(false)
      }
    } catch (e) {
      console.error('Download failed:', e)
    } finally {
      // Remove from global download queue
      removeFromDownloadQueue(recording.id)
    }
  }, [downloadQueue, addToDownloadQueue, updateDownloadProgress, removeFromDownloadQueue, refreshRecordings])

  // Delete recording from device (memoized)
  const handleDeleteFromDevice = useCallback(async (recording: UnifiedRecording) => {
    if (recording.location !== 'device-only' && recording.location !== 'both') return

    const deviceService = getHiDockDeviceService()
    if (!deviceService.isConnected()) return

    // Confirm deletion
    const confirmed = window.confirm(`Delete "${recording.filename}" from device? This cannot be undone.`)
    if (!confirmed) return

    setDeleting(recording.id)
    try {
      const filename = ('deviceFilename' in (recording as any)) ? (recording as any).deviceFilename : recording.filename
      await deviceService.deleteRecording(filename)
      await refreshRecordings(true)
    } catch (e) {
      console.error('Delete failed:', e)
    } finally {
      setDeleting(null)
    }
  }, [refreshRecordings])

  // Delete local recording (memoized)
  const handleDeleteLocal = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) return

    const confirmed = window.confirm(`Delete "${recording.filename}" from local storage? This cannot be undone.`)
    if (!confirmed) return

    setDeleting(recording.id)
    try {
      await window.electronAPI.recordings.delete(recording.id)
      await refreshRecordings(false)
    } catch (e) {
      console.error('Delete failed:', e)
    } finally {
      setDeleting(null)
    }
  }, [refreshRecordings])

  // Trigger transcription for a local recording (memoized)
  const handleTranscribe = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) {
      alert('Cannot transcribe: file not available locally. Download from device first.')
      return
    }
    if (recording.transcriptionStatus === 'processing' || recording.transcriptionStatus === 'complete') return

    setTranscribing(recording.id)
    try {
      const result: any = await window.electronAPI.recordings.transcribe(recording.id)
      if (result && result.success === false) {
        console.error('Transcription failed:', result.error)
        alert(`Transcription failed: ${result.error}`)
      } else {
        // Refresh to see updated status
        await refreshRecordings(false)
      }
    } catch (e) {
      console.error('Transcription failed:', e)
      alert(`Transcription failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setTranscribing(null)
    }
  }, [refreshRecordings])

  // Selection handlers (memoized)
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // For list view, apply filters and sorting
  const filteredRecordings = useMemo(() => {
    let filtered = [...unifiedRecordings]

    // Apply location filter
    if (locationFilter !== 'all') {
      filtered = filtered.filter(r => r.location === locationFilter)
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return b.dateRecorded.getTime() - a.dateRecorded.getTime()
        case 'date-asc':
          return a.dateRecorded.getTime() - b.dateRecorded.getTime()
        case 'name-asc':
          return a.filename.localeCompare(b.filename)
        case 'name-desc':
          return b.filename.localeCompare(a.filename)
        case 'size-desc':
          return (b.size || 0) - (a.size || 0)
        default:
          return 0
      }
    })

    return filtered
  }, [unifiedRecordings, locationFilter, sortBy])

  // SelectAll and bulk handlers need filteredRecordings, defined after useMemo
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredRecordings.map(r => r.id)))
  }, [filteredRecordings])

  // Bulk download selected device-only recordings (memoized)
  const handleBulkDownload = useCallback(async () => {
    const toDownload = filteredRecordings.filter(
      (r): r is DeviceOnlyRecording => selectedIds.has(r.id) && isDeviceOnly(r)
    )
    if (toDownload.length === 0) return

    const deviceService = getHiDockDeviceService()
    if (!deviceService.isConnected()) return

    setBulkDownloading(true)
    
    // Set initial total count for sidebar progress
    setDeviceSyncState({
      deviceSyncing: true,
      deviceSyncProgress: { current: 0, total: toDownload.length }
    })
    
    // Process sequentially but show progress for each
    let completedCount = 0
    for (const rec of toDownload) {
      // Skip if already downloading
      if (downloadQueue.has(rec.id)) {
        completedCount++
        continue
      }
      
      addToDownloadQueue(rec.id, rec.deviceFilename, rec.size)
      
      try {
        await deviceService.downloadRecordingToFile(
          rec.deviceFilename,
          rec.size,
          '',
          (received) => {
            const percent = Math.round((received / rec.size) * 100)
            updateDownloadProgress(rec.id, percent)
          },
          rec.dateRecorded // Pass the original recording date from device
        )
        completedCount++
        // Update sidebar progress count
        setDeviceSyncState({
          deviceSyncProgress: { current: completedCount, total: toDownload.length }
        })
      } catch (e) {
        console.error('Download failed:', rec.filename, e)
      } finally {
        removeFromDownloadQueue(rec.id)
      }
    }
    
    await refreshRecordings(false)
    setBulkDownloading(false)
    setDeviceSyncState({ deviceSyncing: false, deviceSyncProgress: null })
    clearSelection()
  }, [filteredRecordings, selectedIds, refreshRecordings, clearSelection, downloadQueue, addToDownloadQueue, updateDownloadProgress, removeFromDownloadQueue, setDeviceSyncState])

  // Location filter handler (memoized)
  const handleLocationFilterChange = useCallback((filter: LocationFilter) => {
    setLocationFilter(filter)
  }, [])

  // Sort handler (memoized)
  const handleSortChange = useCallback((sort: SortOption) => {
    setSortBy(sort)
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-col h-full">
      {/* Header - using extracted component */}
      <CalendarHeader
        title={showListView ? 'Recordings' : monthYear}
        showListView={showListView}
        calendarView={calendarView}
        calendarSyncing={calendarSyncing}
        lastSync={lastSync}
        autoSyncEnabled={autoSyncEnabled}
        hideEmptyMeetings={hideEmptyMeetings}
        formatLastSync={formatLastSync}
        onNavigatePrev={handleNavigatePrev}
        onNavigateNext={handleNavigateNext}
        onGoToToday={goToToday}
        onSync={handleSync}
        onAutoSyncToggle={handleAutoSyncToggle}
        onHideEmptyToggle={handleHideEmptyToggle}
        onViewToggle={handleViewToggle}
        onCalendarViewChange={handleCalendarViewChange}
      />

      {/* Stats bar - using extracted component */}
      <CalendarStatsBar
        stats={stats}
        locationFilter={locationFilter}
        sortBy={sortBy}
        showListView={showListView}
        deviceConnected={deviceConnected}
        onLocationFilterChange={handleLocationFilterChange}
        onSortChange={handleSortChange}
      />

      {/* Main Content */}
      {(meetingsLoading || recordingsLoading) && meetings.length === 0 && unifiedRecordings.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : showListView ? (
        /* List/Cards View */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Bulk Actions Bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-4 px-6 py-2 bg-primary/10 border-b flex-shrink-0">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Button variant="outline" size="sm" onClick={clearSelection}>Clear</Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleBulkDownload}
                disabled={bulkDownloading || !deviceConnected}
              >
                {bulkDownloading ? <RefreshCw className="h-3 w-3 animate-spin mr-2" /> : <Download className="h-3 w-3 mr-2" />}
                Download Selected
              </Button>
            </div>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center justify-between px-6 py-2 border-b flex-shrink-0">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll} className="h-7 text-xs">
                Select All
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === 'compact' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => setViewMode('compact')}
                title="Compact list"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => setViewMode('cards')}
                title="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4">
            {filteredRecordings.length === 0 ? (
              <div className="text-center py-16">
                <Mic className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Recordings</h3>
                <p className="text-muted-foreground">
                  {locationFilter !== 'all' ? 'No recordings match the current filter.' : 'No recordings found.'}
                </p>
              </div>
            ) : viewMode === 'cards' ? (
              /* Card View - Responsive Grid */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {filteredRecordings.map((recording) => {
                  const canPlay = hasLocalPath(recording)
                  const isSelected = selectedIds.has(recording.id)

                  return (
                    <div
                      key={recording.id}
                      onClick={() => toggleSelection(recording.id)}
                      className={cn(
                        'relative p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md',
                        isSelected ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-muted/50'
                      )}
                    >
                      {/* Selection indicator */}
                      <div className="absolute top-2 right-2">
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground/30" />
                        )}
                      </div>

                      {/* Location icon */}
                      <div className="mb-2">
                        <StatusIcon location={recording.location} />
                      </div>

                      {/* Date */}
                      <div className="text-xs font-medium">
                        {formatShortDate(recording.dateRecorded)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatShortTime(recording.dateRecorded)}
                      </div>

                      {/* Duration */}
                      {recording.duration > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDuration(recording.duration)}
                        </div>
                      )}

                      {/* Transcription status */}
                      {recording.transcriptionStatus !== 'none' && (
                        <div className={cn(
                          'mt-2 text-xs px-1.5 py-0.5 rounded text-center',
                          recording.transcriptionStatus === 'complete' && 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
                          recording.transcriptionStatus === 'processing' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
                          recording.transcriptionStatus === 'error' && 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                        )}>
                          {recording.transcriptionStatus === 'complete' ? <FileText className="h-3 w-3 inline" /> : recording.transcriptionStatus}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-1 mt-2" onClick={e => e.stopPropagation()}>
                        {isDeviceOnly(recording) && (
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => handleDownload(recording)}
                            disabled={!deviceConnected || downloadQueue.has(recording.id)}
                            title="Download">
                            {downloadQueue.has(recording.id) ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                          </Button>
                        )}
                        {canPlay && hasLocalPath(recording) && (
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => {
                              if (currentlyPlayingId === recording.id) {
                                audioControls.stop()
                              } else {
                                audioControls.play(recording.id, recording.localPath)
                              }
                            }}
                            title="Play">
                            {currentlyPlayingId === recording.id ? <X className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                          </Button>
                        )}
                        {/* Transcribe button */}
                        {hasLocalPath(recording) && recording.transcriptionStatus !== 'complete' && recording.transcriptionStatus !== 'processing' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-500 hover:text-blue-600"
                            onClick={() => handleTranscribe(recording)}
                            disabled={transcribing === recording.id}
                            title="Transcribe">
                            {transcribing === recording.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FileAudio className="h-3 w-3" />}
                          </Button>
                        )}
                        {/* Delete - device-only: delete from device */}
                        {recording.location === 'device-only' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteFromDevice(recording)}
                            disabled={!deviceConnected || deleting === recording.id}
                            title="Delete from device">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                        {/* Delete - local-only: delete local file */}
                        {recording.location === 'local-only' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-orange-500 hover:text-orange-600"
                            onClick={() => handleDeleteLocal(recording)}
                            disabled={deleting === recording.id}
                            title="Delete local file">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                        {/* Delete - both: delete local copy only */}
                        {recording.location === 'both' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-orange-500"
                            onClick={() => handleDeleteLocal(recording)}
                            disabled={deleting === recording.id}
                            title="Delete local copy">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* Compact List View */
              <div className="space-y-px">
                {filteredRecordings.map((recording) => {
                  const canPlay = hasLocalPath(recording)
                  const isSelected = selectedIds.has(recording.id)

                  return (
                    <div
                      key={recording.id}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm',
                        isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                      )}
                    >
                      {/* Checkbox */}
                      <button onClick={() => toggleSelection(recording.id)} className="flex-shrink-0">
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground/50" />
                        )}
                      </button>

                      {/* Location */}
                      <StatusIcon location={recording.location} />

                      {/* Date */}
                      <span className="w-20 flex-shrink-0 text-muted-foreground text-xs">
                        {formatShortDate(recording.dateRecorded)}
                      </span>

                      {/* Time */}
                      <span className="w-16 flex-shrink-0 text-muted-foreground text-xs">
                        {formatShortTime(recording.dateRecorded)}
                      </span>

                      {/* Filename */}
                      <span className="flex-1 truncate font-mono text-xs" title={recording.filename}>
                        {recording.filename}
                      </span>

                      {/* Duration */}
                      <span className="w-14 flex-shrink-0 text-right text-xs text-muted-foreground">
                        {recording.duration ? formatDuration(recording.duration) : '—'}
                      </span>

                      {/* Status icon */}
                      <span className="w-6 flex-shrink-0 text-center">
                        {recording.transcriptionStatus === 'complete' && <FileText className="h-3 w-3 text-green-500 inline" />}
                        {recording.transcriptionStatus === 'processing' && <RefreshCw className="h-3 w-3 text-yellow-500 animate-spin inline" />}
                      </span>

                      {/* Actions */}
                      <div className="flex gap-1 flex-shrink-0">
                        {isDeviceOnly(recording) && (
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); handleDownload(recording) }}
                            disabled={!deviceConnected || downloadQueue.has(recording.id)}
                            title="Download from device">
                            {downloadQueue.has(recording.id) ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                          </Button>
                        )}
                        {canPlay && hasLocalPath(recording) && (
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (currentlyPlayingId === recording.id) {
                                audioControls.stop()
                              } else {
                                audioControls.play(recording.id, recording.localPath)
                              }
                            }}
                            title="Play">
                            {currentlyPlayingId === recording.id ? <X className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                          </Button>
                        )}
                        {/* Transcribe button - show for local recordings without transcript */}
                        {hasLocalPath(recording) && recording.transcriptionStatus !== 'complete' && recording.transcriptionStatus !== 'processing' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-500 hover:text-blue-600"
                            onClick={(e) => { e.stopPropagation(); handleTranscribe(recording) }}
                            disabled={transcribing === recording.id}
                            title="Transcribe">
                            {transcribing === recording.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FileAudio className="h-3 w-3" />}
                          </Button>
                        )}
                        {/* Delete from device - only for device-only recordings */}
                        {recording.location === 'device-only' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); handleDeleteFromDevice(recording) }}
                            disabled={!deviceConnected || deleting === recording.id}
                            title="Delete from device">
                            {deleting === recording.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </Button>
                        )}
                        {/* Delete local - only for local-only recordings */}
                        {recording.location === 'local-only' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-orange-500 hover:text-orange-600"
                            onClick={(e) => { e.stopPropagation(); handleDeleteLocal(recording) }}
                            disabled={deleting === recording.id}
                            title="Delete local file">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                        {/* Delete for synced recordings (both locations) - deletes local copy only */}
                        {recording.location === 'both' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-orange-500"
                            onClick={(e) => { e.stopPropagation(); handleDeleteLocal(recording) }}
                            disabled={deleting === recording.id}
                            title="Delete local copy (keeps on device)">
                            {deleting === recording.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Audio player */}
          {currentlyPlayingId && (
            <div className="border-t bg-background p-4 flex-shrink-0">
              {(() => {
                const rec = filteredRecordings.find(r => r.id === currentlyPlayingId)
                if (rec && hasLocalPath(rec)) {
                  return (
                    <AudioPlayer
                      filename={rec.filename}
                      onClose={() => audioControls.stop()}
                    />
                  )
                }
                return null
              })()}
            </div>
          )}
        </div>
      ) : calendarView === 'month' ? (
        /* Month View */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Day of Week Headers */}
          <div className="grid grid-cols-7 border-b flex-shrink-0">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
              <div key={day} className={cn(
                'text-center py-2 text-xs font-medium border-l first:border-l-0',
                !workDays.includes(idx) && 'text-muted-foreground bg-muted/30'
              )}>
                {day}
              </div>
            ))}
          </div>

          {/* Month Grid */}
          <div className="flex-1 overflow-auto">
            <div className="grid grid-cols-7 h-full" style={{ gridAutoRows: 'minmax(100px, 1fr)' }}>
              {monthDates.map((date) => {
                const key = date.toISOString().split('T')[0]
                const dayMeetings = meetingsByMonth[key] || []
                const today = isToday(date)
                const isCurrentMonth = date.getMonth() === currentDate.getMonth()
                const isWeekend = !isWorkDay(date)

                return (
                  <div
                    key={key}
                    className={cn(
                      'border-l border-b first:border-l-0 p-1 min-h-[100px]',
                      !isCurrentMonth && 'bg-muted/30',
                      isWeekend && isCurrentMonth && 'bg-slate-50 dark:bg-slate-900/30',
                      today && 'ring-2 ring-inset ring-primary/30'
                    )}
                  >
                    {/* Date Number */}
                    <div className={cn(
                      'text-sm font-medium mb-1',
                      !isCurrentMonth && 'text-muted-foreground',
                      today && 'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center'
                    )}>
                      {date.getDate()}
                    </div>

                    {/* Meetings for this day */}
                    <div className="space-y-1">
                      {dayMeetings.slice(0, 3).map((meeting) => (
                        <button
                          key={meeting.id}
                          onClick={() => {
                            if (meeting.isPlaceholder || meeting.hasConflicts) {
                              if (meeting.matchedRecordingId) {
                                setLinkDialogRecording({
                                  id: meeting.matchedRecordingId,
                                  filename: meeting.subject,
                                  date_recorded: meeting.start_time,
                                  duration_seconds: meeting.recordingDurationSeconds
                                })
                              }
                            } else {
                              handleMeetingClick(meeting)
                            }
                          }}
                          className={cn(
                            'w-full text-left text-xs p-1 rounded truncate transition-colors',
                            'hover:ring-1 hover:ring-ring',
                            meeting.hasRecording && !meeting.isPlaceholder && 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
                            meeting.isPlaceholder && 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-dashed border border-amber-300',
                            meeting.recordingLocation === 'device-only' && 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
                            !meeting.hasRecording && !meeting.isPlaceholder && 'bg-gray-50/50 text-gray-400 dark:bg-gray-800/30 dark:text-gray-500 opacity-50 border border-dashed border-gray-300',
                            meeting.hasConflicts && 'ring-1 ring-orange-400'
                          )}
                        >
                          <span className="flex items-center gap-1">
                            {meeting.hasRecording && meeting.recordingLocation && (
                              <StatusIcon location={meeting.recordingLocation} />
                            )}
                            {meeting.hasRecording && !meeting.recordingLocation && (
                              <Mic className="h-3 w-3 flex-shrink-0" />
                            )}
                            <span className="truncate">{meeting.subject}</span>
                          </span>
                        </button>
                      ))}
                      {dayMeetings.length > 3 && (
                        <div className="text-xs text-muted-foreground pl-1">
                          +{dayMeetings.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Day/Workweek/Week View */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Day Headers - fixed, with scrollbar gutter to match content */}
          <div className="flex border-b flex-shrink-0 overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
            <div className="w-14 flex-shrink-0" />
            {viewDates.map((date) => {
              const key = date.toISOString().split('T')[0]
              const today = isToday(date)
              const isWeekend = !isWorkDay(date)

              return (
                <div
                  key={key}
                  className={cn(
                    'flex-1 text-center py-3 border-l',
                    isWeekend && 'bg-slate-50 dark:bg-slate-900/30',
                    today && 'ring-2 ring-inset ring-primary/30'
                  )}
                >
                  <div className={cn(
                    'text-xs font-medium uppercase tracking-wide',
                    isWeekend ? 'text-muted-foreground' : 'text-muted-foreground'
                  )}>
                    {date.toLocaleDateString('en-US', { weekday: calendarView === 'day' ? 'long' : 'short' })}
                  </div>
                  <div
                    className={cn(
                      'text-xl font-semibold mt-1',
                      today && 'bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center mx-auto'
                    )}
                  >
                    {date.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Time Grid - scrollable, with stable scrollbar gutter */}
          <div ref={scrollContainerRef} className="flex-1 overflow-auto" style={{ scrollbarGutter: 'stable' }}>
            <div className="flex min-h-full">
              {/* Time Labels */}
              <div className="w-14 flex-shrink-0 bg-background">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="relative"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    <span className="absolute -top-2 right-2 text-xs text-muted-foreground font-medium">
                      {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                    </span>
                  </div>
                ))}
              </div>

              {/* Day Columns */}
              {viewDates.map((date) => {
                const key = date.toISOString().split('T')[0]
                const dayMeetings = meetingsByDay[key] || []
                const today = isToday(date)
                const isWeekend = !isWorkDay(date)

                return (
                  <div
                    key={key}
                    className={cn(
                      'flex-1 border-l relative',
                      isWeekend && 'bg-slate-50/50 dark:bg-slate-900/20',
                      today && 'ring-2 ring-inset ring-primary/20'
                    )}
                  >
                    {/* Hour Lines with office hours shading */}
                    {HOURS.map((hour) => (
                      <div
                        key={hour}
                        className={cn(
                          'border-b border-border/30',
                          !isOfficeHour(hour) && !isWeekend && 'bg-slate-100/50 dark:bg-slate-800/30'
                        )}
                        style={{ height: HOUR_HEIGHT }}
                      />
                    ))}

                    {/* Current Time Indicator */}
                    {today && (
                      <div
                        className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
                        style={{
                          top: Math.max(0, (new Date().getHours() + new Date().getMinutes() / 60 - START_HOUR) * HOUR_HEIGHT)
                        }}
                      >
                        <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-red-500 rounded-full" />
                      </div>
                    )}

                    {/* ===== MEETING OVERLAYS (DASHED - SECONDARY) ===== */}
                    {/* Meetings WITHOUT recordings shown as dashed ghost blocks */}
                    {(meetingOverlaysByDay[key] || []).map((meeting) => {
                      const { top, height } = getMeetingOverlayStyle(meeting)

                      const startHour = meeting.startTime.getHours()
                      if (startHour < START_HOUR || startHour >= END_HOUR) return null

                      const canShowTime = height > 35

                      return (
                        <Tooltip key={`overlay-${meeting.id}`}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleMeetingClick({ id: meeting.id } as Meeting)}
                              className={cn(
                                'absolute w-[calc(100%-8px)] left-1 rounded-md px-2 py-1 text-xs overflow-hidden transition-all text-left',
                                'border-2 border-dashed border-slate-300 dark:border-slate-600',
                                'bg-slate-50/30 dark:bg-slate-800/20 text-slate-400 dark:text-slate-500',
                                'hover:bg-slate-100/50 dark:hover:bg-slate-700/30 hover:border-slate-400',
                                'opacity-60 hover:opacity-80'
                              )}
                              style={{
                                top,
                                height,
                                minHeight: 24,
                                zIndex: 5 // Below recordings
                              }}
                            >
                              <div className="flex items-start gap-1 h-full">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium leading-tight truncate">
                                    {meeting.subject}
                                  </div>
                                  {canShowTime && (
                                    <div className="text-[10px] mt-0.5 opacity-70">
                                      {formatTime(meeting.startTime.toISOString())} - {formatTime(meeting.endTime.toISOString())}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start">
                            <MeetingOverlayTooltipContent meeting={meeting} />
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}

                    {/* ===== RECORDINGS (SOLID - PRIMARY) ===== */}
                    {/* Recordings shown as solid blocks - positioned by RECORDING time */}
                    {(recordingsByDay[key] || []).map((recording, recIdx) => {
                      const { top, height } = getRecordingStyle(recording)

                      const startHour = recording.startTime.getHours()
                      if (startHour < START_HOUR || startHour >= END_HOUR) return null

                      const canShowTime = height > 35
                      const canShowMultiline = height > 60

                      // Display label: meeting subject if linked, otherwise filename
                      const displayLabel = recording.linkedMeeting?.subject || recording.filename

                      return (
                        <Tooltip key={recording.id}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleRecordingClick(recording)}
                              className={cn(
                                'absolute w-[calc(100%-8px)] left-1 rounded-md px-2 py-1 text-xs overflow-hidden transition-all text-left',
                                'hover:ring-2 hover:ring-ring hover:z-30 hover:shadow-lg',
                                'shadow-sm',
                                // Synced/downloaded recording (green)
                                (recording.location === 'both' || recording.location === 'local-only') &&
                                  'bg-emerald-500 text-white border-l-4 border-emerald-700',
                                // Device-only recording (orange)
                                recording.location === 'device-only' &&
                                  'bg-orange-500 text-white border-l-4 border-orange-700',
                                // No linked meeting - slightly different shade
                                !recording.linkedMeeting && recording.location !== 'device-only' &&
                                  'bg-amber-500 text-white border-l-4 border-amber-700'
                              )}
                              style={{
                                top,
                                height,
                                minHeight: 24,
                                zIndex: 15 + recIdx // Above meeting overlays
                              }}
                            >
                              <div className="flex items-start gap-1 h-full relative z-10">
                                <Mic className="h-3 w-3 flex-shrink-0 mt-0.5 opacity-90" />
                                <div className="flex-1 min-w-0">
                                  <div className={cn(
                                    'font-semibold leading-tight',
                                    canShowMultiline ? 'line-clamp-2' : 'truncate'
                                  )}>
                                    {displayLabel}
                                  </div>
                                  {canShowTime && (
                                    <div className={cn(
                                      'text-[10px] mt-0.5 opacity-80',
                                      canShowMultiline ? '' : 'truncate'
                                    )}>
                                      {formatTime(recording.startTime.toISOString())} - {formatTime(recording.endTime.toISOString())}
                                      {recording.durationSeconds > 0 && ` (${formatDurationStr(recording.durationSeconds)})`}
                                    </div>
                                  )}
                                </div>
                                <StatusIcon location={recording.location} />
                              </div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start">
                            <RecordingTooltipContent recording={recording} />
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>

      {/* Recording Link Dialog */}
      <RecordingLinkDialog
        recording={linkDialogRecording}
        open={!!linkDialogRecording}
        onClose={() => setLinkDialogRecording(null)}
        onResolved={() => {
          setLinkDialogRecording(null)
          const startDate = viewDates[0].toISOString()
          const endDate = new Date(viewDates[viewDates.length - 1])
          endDate.setHours(23, 59, 59, 999)
          loadMeetings(startDate, endDate.toISOString())
        }}
      />
    </TooltipProvider>
  )
}
