import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import {
  UnifiedRecording,
  hasLocalPath,
  isDeviceOnly,
  matchesSemanticFilter,
  matchesExclusiveFilter
} from '@/types/unified-recording'
import { Transcript, Meeting } from '@/types'
import { useAudioControls } from '@/components/OperationController'
import { useUIStore } from '@/store/useUIStore'
import { useAppStore } from '@/store/useAppStore'
import {
  LibraryHeader,
  LibraryFilters,
  SourceRow,
  SourceCard,
  EmptyState,
  DeviceDisconnectBanner,
  BulkActionsBar,
  LiveRegion,
  useAnnouncement,
  BulkProgressModal,
  BulkResultSummary,
  SourceDetailDrawer,
  TriPaneLayout,
  SourceReader,
  AssistantPanel
} from '@/features/library/components'
import { useSourceSelection, useKeyboardNavigation, useTransitionFilters } from '@/features/library/hooks'
import { useLibraryStore } from '@/store/useLibraryStore'

export function Library() {
  const navigate = useNavigate()
  const location = useLocation()
  const { recordings, loading, error, refresh, deviceConnected, stats } = useUnifiedRecordings()

  // Selected source for center panel
  const selectedSourceId = useLibraryStore((state) => state.selectedSourceId)
  const setSelectedSourceId = useLibraryStore((state) => state.setSelectedSourceId)

  // Centralized audio controls (persists across navigation)
  const audioControls = useAudioControls()
  const currentlyPlayingId = useUIStore((state) => state.currentlyPlayingId)
  const playbackCurrentTime = useUIStore((state) => state.playbackCurrentTime)

  // Get download queue from app store to check download status
  const { downloadQueue, isDownloading } = useAppStore()

  // UI state
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set())

  // Filter state - persisted in store across navigation
  // Using useTransitionFilters for non-blocking filter updates
  const {
    filterMode,
    semanticFilter,
    exclusiveFilter,
    categoryFilter,
    qualityFilter,
    statusFilter,
    searchQuery,
    setFilterMode,
    setSemanticFilter,
    setExclusiveFilter,
    setCategoryFilter,
    setQualityFilter,
    setStatusFilter,
    setSearchQuery,
    isPending: isFilterPending
  } = useTransitionFilters()
  const deferredSearchQuery = useDeferredValue(searchQuery)

  // Row expansion state
  const expandedRowIds = useLibraryStore((state) => state.expandedRowIds)
  const toggleRowExpansion = useLibraryStore((state) => state.toggleRowExpansion)
  const collapseRow = useLibraryStore((state) => state.collapseRow)

  // AbortController for cancelling enrichment on filter changes or navigation
  const enrichmentAbortController = useRef(new AbortController())

  // Reset abort controller when filters change
  useEffect(() => {
    enrichmentAbortController.current.abort()
    enrichmentAbortController.current = new AbortController()
  }, [filterMode, semanticFilter, exclusiveFilter, categoryFilter, qualityFilter, statusFilter, searchQuery])

  // View mode persisted in store across navigation
  const compactView = useUIStore((state) => state.recordingsCompactView)
  const setCompactView = useUIStore((state) => state.setRecordingsCompactView)

  // Bulk operations
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 })
  const [bulkOperationItems] = useState<Array<{ id: string; status: 'pending' | 'processing' | 'success' | 'failed' | 'cancelled' }>>([])
  const [bulkOperationResult, setBulkOperationResult] = useState<{ succeeded: string[]; failed: Array<{ id: string; error: any }>; cancelled: string[]; wasAborted: boolean } | null>(null)
  const [showBulkProgressModal, setShowBulkProgressModal] = useState(false)
  const [showBulkResultModal, setShowBulkResultModal] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Detail drawer state
  const [selectedSourceForDrawer, setSelectedSourceForDrawer] = useState<UnifiedRecording | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Selection for bulk operations
  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    handleSelectionClick
  } = useSourceSelection()

  // Accessibility announcements
  const { message: announcement, announce } = useAnnouncement()

  // Handle navigation state for incoming selectedId
  useEffect(() => {
    const state = location.state as { selectedId?: string } | null
    if (state?.selectedId) {
      // Find the recording with this ID
      const recording = recordings.find((r) => r.id === state.selectedId)
      if (recording) {
        setSelectedSourceId(recording.id)
        // Clear the navigation state to prevent re-triggering on refresh
        navigate(location.pathname, { replace: true, state: {} })
      }
    }
  }, [location.state, recordings, setSelectedSourceId, navigate, location.pathname])

  // Device disconnect handling
  const [wasConnected, setWasConnected] = useState(deviceConnected)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const showDisconnectBanner = wasConnected && !deviceConnected

  // Ref to track latest deviceConnected value (avoids stale closure in setTimeout)
  const deviceConnectedRef = useRef(deviceConnected)

  // Track device connection changes
  useEffect(() => {
    deviceConnectedRef.current = deviceConnected
    if (deviceConnected) {
      setWasConnected(true)
      setIsReconnecting(false)
    }
  }, [deviceConnected])

  // Handle reconnect attempt
  const handleRetryConnection = useCallback(async () => {
    setIsReconnecting(true)
    try {
      await refresh(true)
    } finally {
      // isReconnecting will be cleared when deviceConnected becomes true
      // If reconnection fails, we'll show the banner again after a delay
      setTimeout(() => {
        if (!deviceConnectedRef.current) {
          setIsReconnecting(false)
        }
      }, 5000)
    }
  }, [refresh])

  // Enrichment: Load transcripts and meetings for recordings
  const [transcripts, setTranscripts] = useState<Map<string, Transcript>>(new Map())
  const [meetings, setMeetings] = useState<Map<string, Meeting>>(new Map())

  // Memoize recording IDs that need enrichment to avoid unnecessary re-fetches
  const enrichmentKey = useMemo(() => {
    const localRecordingIds = recordings
      .filter((rec) => hasLocalPath(rec))
      .map((rec) => rec.id)
      .sort()
      .join(',')
    const meetingIds = recordings
      .filter((rec) => hasLocalPath(rec) && rec.meetingId)
      .map((rec) => rec.meetingId!)
      .sort()
      .join(',')
    return `${localRecordingIds}|${meetingIds}`
  }, [recordings])

  // Load enrichment data only when the set of IDs that need data changes
  // Note: The exhaustive-deps disable below is intentional - we use enrichmentKey to avoid
  // refetching when recordings array reference changes but IDs remain the same (optimization pattern)
  useEffect(() => {
    const loadEnrichment = async () => {
      const recordingIdsForTranscripts = recordings.filter((rec) => hasLocalPath(rec)).map((rec) => rec.id)
      const meetingIds = recordings
        .filter((rec) => hasLocalPath(rec) && rec.meetingId)
        .map((rec) => rec.meetingId!)

      try {
        const [transcriptsObj, meetingsObj] = await Promise.all([
          recordingIdsForTranscripts.length > 0
            ? window.electronAPI.transcripts.getByRecordingIds(recordingIdsForTranscripts)
            : Promise.resolve({}),
          meetingIds.length > 0 ? window.electronAPI.meetings.getByIds(meetingIds) : Promise.resolve({})
        ])

        const newTranscripts = new Map<string, Transcript>(Object.entries(transcriptsObj) as [string, Transcript][])
        const newMeetings = new Map<string, Meeting>(Object.entries(meetingsObj) as [string, Meeting][])

        setTranscripts(newTranscripts)
        setMeetings(newMeetings)
      } catch (e) {
        console.error('[Library] Failed to load enrichment data:', e)
      }
    }

    if (recordings.length > 0) {
      loadEnrichment()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichmentKey])

  // Filter recordings based on location and search
  const filteredRecordings = useMemo(() => {
    const filtered = recordings.filter((rec) => {
      // Use dual-mode filter matching (semantic or exclusive)
      const activeFilter = filterMode === 'semantic' ? semanticFilter : exclusiveFilter
      const locationMatches =
        filterMode === 'semantic'
          ? matchesSemanticFilter(rec.location, semanticFilter)
          : matchesExclusiveFilter(rec.location, exclusiveFilter)

      if (!locationMatches) return false
      if (categoryFilter !== null && rec.category !== categoryFilter) return false
      if (qualityFilter !== null && rec.quality !== qualityFilter) return false
      if (statusFilter !== null && rec.status !== statusFilter) return false
      if (deferredSearchQuery) {
        const query = deferredSearchQuery.toLowerCase()
        const filename = rec.filename.toLowerCase()
        const meetingSubject = rec.meetingSubject?.toLowerCase() || ''
        const title = rec.title?.toLowerCase() || ''
        return filename.includes(query) || meetingSubject.includes(query) || title.includes(query)
      }
      return true
    })

    // Development check for duplicate IDs
    if (process.env.NODE_ENV === 'development') {
      const ids = new Set<string>()
      const duplicates = new Set<string>()
      filtered.forEach((rec) => {
        if (ids.has(rec.id)) {
          duplicates.add(rec.id)
        }
        ids.add(rec.id)
      })
      if (duplicates.size > 0) {
        console.warn('[Library] Duplicate recording IDs detected:', Array.from(duplicates))
      }
    }

    return filtered
  }, [recordings, filterMode, semanticFilter, exclusiveFilter, categoryFilter, qualityFilter, statusFilter, deferredSearchQuery])

  // Announce filter result changes (after filteredRecordings is declared)
  useEffect(() => {
    if (!loading && filteredRecordings.length !== recordings.length) {
      announce(`Showing ${filteredRecordings.length} of ${recordings.length} captures`)
    }
  }, [filteredRecordings.length, recordings.length, loading, announce])

  // Memoize the list of IDs for keyboard navigation
  const itemIds = useMemo(() => filteredRecordings.map((r) => r.id), [filteredRecordings])

  // Keyboard navigation for accessibility
  const { handleKeyDown } = useKeyboardNavigation({
    items: itemIds,
    selectedIds,
    onToggleSelection: toggleSelection,
    onSelectAll: selectAll,
    onClearSelection: clearSelection,
    isEnabled: filteredRecordings.length > 0
  })

  // Count recordings that can be bulk processed
  const bulkCounts = useMemo(() => {
    const deviceOnly = filteredRecordings.filter((r) => isDeviceOnly(r)).length
    const needsTranscription = filteredRecordings.filter(
      (r) => hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    ).length
    return { deviceOnly, needsTranscription }
  }, [filteredRecordings])

  // Handlers
  const toggleTranscript = useCallback((id: string) => {
    setExpandedTranscripts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const openRecordingsFolder = async () => {
    await window.electronAPI.storage.openFolder('recordings')
  }

  const handleDownload = useCallback(
    async (recording: UnifiedRecording) => {
      if (!isDeviceOnly(recording)) return
      if (!deviceConnected) return

      try {
        await window.electronAPI.downloadService.queueDownloads([
          {
            filename: recording.deviceFilename,
            size: recording.size,
            dateCreated: recording.dateRecorded.toISOString()
          }
        ])
      } catch (e) {
        console.error('Failed to queue download:', e)
      }
    },
    [deviceConnected]
  )

  const handleAddRecording = async () => {
    try {
      const result = await window.electronAPI.recordings.addExternal()
      if (result.success) {
        await refresh(false)
      } else if (result.error && result.error !== 'No file selected') {
        console.error('Failed to import recording:', result.error)
      }
    } catch (e) {
      console.error('Failed to import recording:', e)
    }
  }

  const handleAskAssistant = useCallback(
    (recording: UnifiedRecording) => {
      navigate('/assistant', { state: { contextId: recording.knowledgeCaptureId || recording.id } })
    },
    [navigate]
  )

  const handleGenerateOutput = useCallback(
    (recording: UnifiedRecording) => {
      navigate('/actionables', { state: { sourceId: recording.knowledgeCaptureId || recording.id, action: 'generate' } })
    },
    [navigate]
  )

  const handleBulkDownload = async () => {
    const deviceOnlyRecordings = filteredRecordings.filter((r) => isDeviceOnly(r))
    if (deviceOnlyRecordings.length === 0) return
    if (!deviceConnected) return

    try {
      await window.electronAPI.downloadService.queueDownloads(
        deviceOnlyRecordings.map((r) => ({
          filename: r.deviceFilename,
          size: r.size,
          dateCreated: r.dateRecorded.toISOString()
        }))
      )
    } catch (e) {
      console.error('Failed to queue bulk downloads:', e)
    }
  }

  const handleBulkProcess = async () => {
    const needsProcessing = filteredRecordings.filter(
      (r) => hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    )
    if (needsProcessing.length === 0) return

    setBulkProcessing(true)
    setBulkProgress({ current: 0, total: needsProcessing.length })

    try {
      for (let i = 0; i < needsProcessing.length; i++) {
        const recording = needsProcessing[i]
        setBulkProgress({ current: i + 1, total: needsProcessing.length })

        try {
          await window.electronAPI.recordings.updateStatus(recording.id, 'pending')
        } catch (e) {
          console.error('Failed to queue:', recording.filename, e)
        }
      }
      await refresh(false)
    } finally {
      setBulkProcessing(false)
      setBulkProgress({ current: 0, total: 0 })
    }
  }

  // Selection-based bulk operations
  const handleSelectedDownload = useCallback(async () => {
    const selectedRecordings = filteredRecordings.filter((r) => selectedIds.has(r.id) && isDeviceOnly(r))
    if (selectedRecordings.length === 0) return
    if (!deviceConnected) return

    try {
      await window.electronAPI.downloadService.queueDownloads(
        selectedRecordings.map((r) => ({
          filename: 'deviceFilename' in r ? r.deviceFilename : r.filename,
          size: r.size,
          dateCreated: r.dateRecorded.toISOString()
        }))
      )
      clearSelection()
    } catch (e) {
      console.error('Failed to queue selected downloads:', e)
    }
  }, [filteredRecordings, selectedIds, deviceConnected, clearSelection])

  const handleSelectedProcess = useCallback(async () => {
    const selectedRecordings = filteredRecordings.filter(
      (r) => selectedIds.has(r.id) && hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    )
    if (selectedRecordings.length === 0) return

    setBulkProcessing(true)
    setBulkProgress({ current: 0, total: selectedRecordings.length })

    try {
      for (let i = 0; i < selectedRecordings.length; i++) {
        const recording = selectedRecordings[i]
        setBulkProgress({ current: i + 1, total: selectedRecordings.length })

        try {
          await window.electronAPI.recordings.updateStatus(recording.id, 'pending')
        } catch (e) {
          console.error('Failed to queue:', recording.filename, e)
        }
      }
      await refresh(false)
      clearSelection()
    } finally {
      setBulkProcessing(false)
      setBulkProgress({ current: 0, total: 0 })
    }
  }, [filteredRecordings, selectedIds, refresh, clearSelection])

  // PESSIMISTIC UPDATE: Server-first bulk delete with transaction boundary
  const handleSelectedDelete = useCallback(async () => {
    const selectedRecordings = filteredRecordings.filter((r) => selectedIds.has(r.id))
    if (selectedRecordings.length === 0) return

    const hasLocalFiles = selectedRecordings.some((r) => hasLocalPath(r))
    const hasDeviceFiles = selectedRecordings.some((r) => isDeviceOnly(r))

    let message = `Delete ${selectedRecordings.length} selected item${selectedRecordings.length > 1 ? 's' : ''}?`
    if (hasLocalFiles && hasDeviceFiles) {
      message += ' This includes both local files and device recordings.'
    } else if (hasLocalFiles) {
      message += ' This will remove local files and any transcripts.'
    } else {
      message += ' This cannot be undone.'
    }

    if (!window.confirm(message)) return

    setBulkProcessing(true)
    setBulkProgress({ current: 0, total: selectedRecordings.length })

    const errors: Array<{ filename: string; error: any }> = []

    try {
      // Step 1: Delete all recordings on server FIRST
      for (let i = 0; i < selectedRecordings.length; i++) {
        const recording = selectedRecordings[i]
        setBulkProgress({ current: i + 1, total: selectedRecordings.length })

        try {
          await window.electronAPI.recordings.delete(recording.id)
        } catch (e) {
          console.error('Failed to delete:', recording.filename, e)
          errors.push({ filename: recording.filename, error: e })
        }
      }

      // Step 2: Refresh data from server to update UI (only if some deletions succeeded)
      const successCount = selectedRecordings.length - errors.length
      if (successCount > 0) {
        await refresh(false)
      }

      // Step 3: Clear selection ONLY after successful refresh
      clearSelection()

      // Step 4: Show summary to user
      if (errors.length > 0) {
        alert(`Deleted ${successCount} of ${selectedRecordings.length} items. ${errors.length} failed.`)
      }
    } finally {
      setBulkProcessing(false)
      setBulkProgress({ current: 0, total: 0 })
    }
  }, [filteredRecordings, selectedIds, refresh, clearSelection])

  // PESSIMISTIC UPDATE: Server-first delete with proper error handling
  const handleDeleteFromDevice = useCallback(async (recording: UnifiedRecording) => {
    if (!deviceConnected) return
    if (!('deviceFilename' in recording)) return
    if (!window.confirm(`Delete "${recording.filename}" from device? This cannot be undone.`)) return

    setDeleting(recording.id)
    try {
      // Step 1: Delete on server FIRST
      await window.electronAPI.recordings.delete(recording.id)

      // Step 2: Clean up expanded state
      collapseRow(recording.id)

      // Step 3: Refresh data from server to update UI ONLY on success
      await refresh(false)
    } catch (e) {
      console.error('Failed to delete from device:', e)
      // User feedback on error (no rollback needed since we never updated state)
      alert(`Failed to delete "${recording.filename}" from device. Please try again.`)
    } finally {
      setDeleting(null)
    }
  }, [deviceConnected, refresh, collapseRow])

  // PESSIMISTIC UPDATE: Server-first delete with proper error handling
  const handleDeleteLocal = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) return
    const hasTranscript = transcripts.has(recording.id)
    const message = hasTranscript
      ? `Delete local file and transcript for "${recording.filename}"? The transcript data will be lost.`
      : `Delete local file "${recording.filename}"?`
    if (!window.confirm(message)) return

    setDeleting(recording.id)
    try {
      // Step 1: Delete on server FIRST
      await window.electronAPI.recordings.delete(recording.id)

      // Step 2: Clean up expanded state
      collapseRow(recording.id)

      // Step 3: Refresh data from server to update UI ONLY on success
      await refresh(false)
    } catch (e) {
      console.error('Failed to delete local file:', e)
      // User feedback on error (no rollback needed since we never updated state)
      alert(`Failed to delete "${recording.filename}". Please try again.`)
    } finally {
      setDeleting(null)
    }
  }, [transcripts, refresh, collapseRow])

  const handleDelete = useCallback(
    (recording: UnifiedRecording) => {
      if (recording.location === 'device-only') {
        handleDeleteFromDevice(recording)
      } else {
        handleDeleteLocal(recording)
      }
    },
    [handleDeleteFromDevice, handleDeleteLocal]
  )

  // Stable callbacks for child components (prevents breaking React.memo)
  const handlePlayCallback = useCallback(
    (recordingId: string, localPath: string) => {
      audioControls.play(recordingId, localPath)
    },
    [audioControls]
  )

  const handleStopCallback = useCallback(() => {
    audioControls.stop()
  }, [audioControls])

  const handleClosePlayer = useCallback(() => {
    audioControls.stop()
    setSelectedSourceId(null)
  }, [audioControls, setSelectedSourceId])

  const handleNavigateToMeeting = useCallback(
    (meetingId: string) => {
      navigate(`/meeting/${meetingId}`)
    },
    [navigate]
  )

  // Create stable callback wrappers that accept recording parameter
  const handleDownloadCallback = useCallback(
    (recording: UnifiedRecording) => {
      handleDownload(recording)
    },
    [handleDownload]
  )

  const handleDeleteCallback = useCallback(
    (recording: UnifiedRecording) => {
      handleDelete(recording)
    },
    [handleDelete]
  )

  const handleAskAssistantCallback = useCallback(
    (recording: UnifiedRecording) => {
      handleAskAssistant(recording)
    },
    [handleAskAssistant]
  )

  const handleGenerateOutputCallback = useCallback(
    (recording: UnifiedRecording) => {
      handleGenerateOutput(recording)
    },
    [handleGenerateOutput]
  )

  const handleToggleTranscriptCallback = useCallback(
    (recordingId: string) => {
      toggleTranscript(recordingId)
    },
    [toggleTranscript]
  )

  // Handle row click for tri-pane layout
  const handleRowClick = useCallback((recording: UnifiedRecording) => {
    // Stop any currently playing audio before switching to new recording
    audioControls.stop()
    setSelectedSourceId(recording.id)
  }, [setSelectedSourceId, audioControls])

  // Get selected recording and its data for SourceReader
  const selectedRecording = selectedSourceId ? recordings.find((r) => r.id === selectedSourceId) : null
  const selectedTranscript = selectedRecording ? transcripts.get(selectedRecording.id) : undefined

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    // Clear selection after animation completes
    setTimeout(() => setSelectedSourceForDrawer(null), 300)
  }, [])

  // Virtualization setup
  const parentRef = useRef<HTMLDivElement>(null)

  const estimateSize = useCallback(
    (index: number) => {
      const recording = filteredRecordings[index]
      if (!recording) return compactView ? 52 : 200

      // Base height
      let height = compactView ? 52 : 120

      // Card view specific additions
      if (!compactView) {
        if (currentlyPlayingId === recording.id) height += 80
        if (recording.meetingId && meetings.get(recording.meetingId)) height += 70
        const transcript = transcripts.get(recording.id)
        if (transcript) {
          height += 50
          if (expandedTranscripts.has(recording.id)) height += 400
        }
        if (isDeviceOnly(recording)) height += 30
      }

      // Add expanded content height for compact view
      if (compactView && expandedRowIds.has(recording.id)) {
        height += 280 // Base expanded content height
        if (transcripts.get(recording.id)?.summary) height += 120 // Transcript summary
        if (recording.meetingId && meetings.get(recording.meetingId)) height += 60 // Meeting card
      }

      return height
    },
    [compactView, filteredRecordings, currentlyPlayingId, meetings, transcripts, expandedTranscripts, expandedRowIds]
  )

  const rowVirtualizer = useVirtualizer({
    count: filteredRecordings.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5
  })

  // Loading state
  if (loading && recordings.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <header className="border-b px-6 py-4">
          <h1 className="text-2xl font-bold">Knowledge Library</h1>
          <p className="text-sm text-muted-foreground">Your captured conversations and insights</p>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <LibraryHeader
        stats={stats}
        deviceConnected={deviceConnected}
        loading={loading}
        compactView={compactView}
        downloadQueueSize={downloadQueue.size}
        bulkCounts={bulkCounts}
        bulkProcessing={bulkProcessing}
        bulkProgress={bulkProgress}
        onAddRecording={handleAddRecording}
        onOpenFolder={openRecordingsFolder}
        onBulkDownload={handleBulkDownload}
        onBulkProcess={handleBulkProcess}
        onRefresh={() => refresh(true)}
        onSetCompactView={setCompactView}
      />

      {/* Device Disconnect Banner */}
      <DeviceDisconnectBanner
        show={showDisconnectBanner}
        isReconnecting={isReconnecting}
        onNavigateToDevice={() => navigate('/device')}
        onRetry={handleRetryConnection}
      />

      {/* Filters */}
      <div className="px-6 relative">
        <div className={isFilterPending ? 'opacity-70 pointer-events-none transition-opacity' : 'transition-opacity'}>
          <LibraryFilters
            stats={stats}
            filterMode={filterMode}
            semanticFilter={semanticFilter}
            exclusiveFilter={exclusiveFilter}
            categoryFilter={categoryFilter ?? 'all'}
            qualityFilter={qualityFilter ?? 'all'}
            statusFilter={statusFilter ?? 'all'}
            searchQuery={searchQuery}
            onFilterModeChange={setFilterMode}
            onSemanticFilterChange={setSemanticFilter}
            onExclusiveFilterChange={setExclusiveFilter}
            onCategoryFilterChange={(filter) => setCategoryFilter(filter === 'all' ? null : filter)}
            onQualityFilterChange={(filter) => setQualityFilter(filter === 'all' ? null : filter)}
            onStatusFilterChange={(filter) => setStatusFilter(filter === 'all' ? null : filter)}
            onSearchQueryChange={setSearchQuery}
          />
        </div>
        {isFilterPending && (
          <div className="absolute top-2 right-2 pointer-events-none">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selectedCount}
        totalCount={filteredRecordings.length}
        deviceConnected={deviceConnected}
        isProcessing={bulkProcessing}
        progress={bulkProgress.total > 0 ? bulkProgress : undefined}
        onSelectAll={() => selectAll(filteredRecordings.map((r) => r.id))}
        onDeselectAll={clearSelection}
        onDownload={handleSelectedDownload}
        onProcess={handleSelectedProcess}
        onDelete={handleSelectedDelete}
      />

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 px-6 py-3 bg-destructive/10 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Accessibility: Live Region for announcements */}
      <LiveRegion message={announcement} />

      {/* Tri-Pane Layout */}
      <div className="flex-1 overflow-hidden">
        <TriPaneLayout
          leftPanel={
            /* Left Panel: Recording List */
            <div
              ref={parentRef}
              className="h-full overflow-auto p-6"
              onKeyDown={handleKeyDown}
              tabIndex={0}
              data-testid="library-list"
            >
        <div className={`max-w-4xl mx-auto transition-opacity ${isFilterPending ? 'opacity-60' : 'opacity-100'}`}>
          {filteredRecordings.length === 0 ? (
            <EmptyState
              hasRecordings={recordings.length > 0}
              onNavigateToDevice={() => navigate('/device')}
              onAddRecording={handleAddRecording}
            />
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
              role="listbox"
              aria-label="Knowledge Library"
              aria-rowcount={filteredRecordings.length}
            >
              {compactView ? (
                // Compact List View
                <div key="compact-view" className="border rounded-lg overflow-hidden">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = filteredRecordings[virtualRow.index]
                    const meeting = recording.meetingId ? meetings.get(recording.meetingId) : undefined

                    return (
                      <div
                        key={recording.id}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`
                        }}
                        className={virtualRow.index > 0 ? 'border-t' : ''}
                        aria-rowindex={virtualRow.index + 1}
                      >
                        <SourceRow
                          recording={recording}
                          meeting={meeting}
                          transcript={expandedRowIds.has(recording.id) ? transcripts.get(recording.id) : undefined}
                          isPlaying={currentlyPlayingId === recording.id}
                          isDownloading={isDeviceOnly(recording) && isDownloading(recording.deviceFilename)}
                          downloadProgress={
                            isDeviceOnly(recording) ? downloadQueue.get(recording.deviceFilename)?.progress : undefined
                          }
                          isDeleting={deleting === recording.id}
                          deviceConnected={deviceConnected}
                          isSelected={isSelected(recording.id)}
                          isExpanded={expandedRowIds.has(recording.id)}
                          onSelectionChange={(id, shiftKey) =>
                            handleSelectionClick(id, shiftKey, filteredRecordings.map((r) => r.id))
                          }
                          onClick={() => handleRowClick(recording)}
                          onToggleExpand={() => toggleRowExpansion(recording.id)}
                          onPlay={() => {
                            if (hasLocalPath(recording)) {
                              handleRowClick(recording)  // Select the recording first
                              handlePlayCallback(recording.id, recording.localPath)
                            }
                          }}
                          onStop={handleStopCallback}
                          onDownload={() => handleDownloadCallback(recording)}
                          onDelete={() => handleDeleteCallback(recording)}
                          onTranscribe={() => {
                            window.electronAPI.recordings.updateStatus(recording.id, 'pending').catch((e) => {
                              console.error('Failed to queue transcription:', e)
                            })
                          }}
                          onAskAssistant={() => handleAskAssistantCallback(recording)}
                          onGenerateOutput={() => handleGenerateOutputCallback(recording)}
                          onNavigateToMeeting={handleNavigateToMeeting}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                // Card View
                <div key="card-view" className="space-y-4">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = filteredRecordings[virtualRow.index]
                    const transcript = transcripts.get(recording.id)
                    const meeting = recording.meetingId ? meetings.get(recording.meetingId) : undefined

                    return (
                      <div
                        key={recording.id}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`
                        }}
                        aria-rowindex={virtualRow.index + 1}
                      >
                        <SourceCard
                          recording={recording}
                          transcript={transcript}
                          meeting={meeting}
                          isPlaying={currentlyPlayingId === recording.id}
                          isTranscriptExpanded={expandedTranscripts.has(recording.id)}
                          isDownloading={isDeviceOnly(recording) && isDownloading(recording.deviceFilename)}
                          downloadProgress={
                            isDeviceOnly(recording) ? downloadQueue.get(recording.deviceFilename)?.progress : undefined
                          }
                          isDeleting={deleting === recording.id}
                          deviceConnected={deviceConnected}
                          isSelected={isSelected(recording.id)}
                          onSelectionChange={(id, shiftKey) =>
                            handleSelectionClick(id, shiftKey, filteredRecordings.map((r) => r.id))
                          }
                          onClick={() => handleRowClick(recording)}
                          onPlay={() => {
                            if (hasLocalPath(recording)) {
                              handleRowClick(recording)  // Select the recording first
                              handlePlayCallback(recording.id, recording.localPath)
                            }
                          }}
                          onStop={handleStopCallback}
                          onDownload={() => handleDownloadCallback(recording)}
                          onDelete={() => handleDeleteCallback(recording)}
                          onAskAssistant={() => handleAskAssistantCallback(recording)}
                          onGenerateOutput={() => handleGenerateOutputCallback(recording)}
                          onToggleTranscript={() => handleToggleTranscriptCallback(recording.id)}
                          onNavigateToMeeting={handleNavigateToMeeting}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
            </div>
          }
          centerPanel={
            /* Center Panel: Source Reader */
            <SourceReader
              recording={selectedRecording ?? null}
              transcript={selectedTranscript}
              isPlaying={selectedRecording ? currentlyPlayingId === selectedRecording.id : false}
              currentTimeMs={playbackCurrentTime * 1000}
              onPlay={() => {
                if (selectedRecording && hasLocalPath(selectedRecording)) {
                  handlePlayCallback(selectedRecording.id, selectedRecording.localPath)
                }
              }}
              onStop={handleClosePlayer}
              onSeek={(startMs) => {
                if (selectedRecording && hasLocalPath(selectedRecording)) {
                  audioControls.seek(startMs / 1000)
                }
              }}
            />
          }
          rightPanel={
            /* Right Panel: AI Assistant */
            <AssistantPanel
              recording={selectedRecording ?? null}
              transcript={selectedTranscript}
              onAskAssistant={handleAskAssistantCallback}
              onGenerateOutput={handleGenerateOutputCallback}
            />
          }
        />
      </div>

      {/* Bulk Progress Modal - shows during bulk operations */}
      <BulkProgressModal
        isOpen={showBulkProgressModal}
        onClose={() => setShowBulkProgressModal(false)}
        operation="download" // TODO: Make this dynamic based on operation type
        items={bulkOperationItems.map((item) => ({
          id: item.id,
          status: item.status,
          data: filteredRecordings.find((r) => r.id === item.id)
        }))}
        progress={bulkProgress}
        onCancel={() => {
          setBulkProcessing(false)
          setShowBulkProgressModal(false)
        }}
      />

      {/* Bulk Result Summary - shows after operations complete */}
      {bulkOperationResult && (
        <BulkResultSummary
          isOpen={showBulkResultModal}
          onClose={() => {
            setShowBulkResultModal(false)
            setBulkOperationResult(null)
          }}
          operation="Download" // TODO: Make this dynamic
          result={bulkOperationResult}
          onRetryFailed={(ids) => {
            // TODO: Implement retry logic
            console.log('Retry failed items:', ids)
          }}
        />
      )}

      {/* Source Detail Drawer */}
      <SourceDetailDrawer
        source={selectedSourceForDrawer}
        transcript={selectedSourceForDrawer ? transcripts.get(selectedSourceForDrawer.id) : undefined}
        meeting={
          selectedSourceForDrawer && selectedSourceForDrawer.meetingId
            ? meetings.get(selectedSourceForDrawer.meetingId)
            : undefined
        }
        isOpen={drawerOpen}
        isPlaying={selectedSourceForDrawer ? currentlyPlayingId === selectedSourceForDrawer.id : false}
        onClose={handleCloseDrawer}
        onPlay={() => {
          if (selectedSourceForDrawer && hasLocalPath(selectedSourceForDrawer)) {
            handlePlayCallback(selectedSourceForDrawer.id, selectedSourceForDrawer.localPath)
          }
        }}
        onStop={handleStopCallback}
        onTranscribe={() => {
          if (selectedSourceForDrawer) {
            // Queue for transcription
            window.electronAPI.recordings.updateStatus(selectedSourceForDrawer.id, 'pending').catch((e) => {
              console.error('Failed to queue transcription:', e)
            })
          }
        }}
        onDownload={() => {
          if (selectedSourceForDrawer) {
            handleDownloadCallback(selectedSourceForDrawer)
          }
        }}
        onDelete={() => {
          if (selectedSourceForDrawer) {
            handleDeleteCallback(selectedSourceForDrawer)
            handleCloseDrawer()
          }
        }}
        onNavigateToMeeting={handleNavigateToMeeting}
        onAskAssistant={() => {
          if (selectedSourceForDrawer) {
            handleAskAssistantCallback(selectedSourceForDrawer)
          }
        }}
        deviceConnected={deviceConnected}
      />
    </div>
  )
}
