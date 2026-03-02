import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
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
import { useDownloadQueue } from '@/store/useAppStore'
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
  TriPaneLayout,
  SourceReader,
  AssistantPanel
} from '@/features/library/components'
import { useSourceSelection, useKeyboardNavigation, useTransitionFilters } from '@/features/library/hooks'
import { useLibraryStore, useLibrarySorting } from '@/store/useLibraryStore'
import { useOperations } from '@/hooks/useOperations'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export function Library() {
  const navigate = useNavigate()
  const location = useLocation()
  const { recordings, loading, error, refresh, deviceConnected, stats } = useUnifiedRecordings()

  // Selected source for center panel
  const selectedSourceId = useLibraryStore((state) => state.selectedSourceId)
  const setSelectedSourceId = useLibraryStore((state) => state.setSelectedSourceId)

  // Centralized operations (downloads + transcriptions)
  const {
    queueTranscription,
    queueBulkTranscriptions,
    queueDownload,
    queueBulkDownloads,
  } = useOperations()

  // Centralized audio controls (persists across navigation)
  const audioControls = useAudioControls()
  const currentlyPlayingId = useUIStore((state) => state.currentlyPlayingId)
  const playbackCurrentTime = useUIStore((state) => state.playbackCurrentTime)

  // SM-03 fix: Use granular selector instead of pulling volatile state
  const downloadQueue = useDownloadQueue()

  // Helper to check if a file is downloading
  const isDownloading = useCallback((filename: string) => {
    return downloadQueue.has(filename)
  }, [downloadQueue])

  // UI state - expandedTranscripts centralized in useLibraryStore (B-LIB-005)
  const expandedTranscripts = useLibraryStore((state) => state.expandedTranscripts)
  const toggleTranscriptExpansion = useLibraryStore((state) => state.toggleTranscriptExpansion)

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

  // Sort state
  const { sortBy, sortOrder } = useLibrarySorting()
  const setSortBy = useLibraryStore((state) => state.setSortBy)
  const setSortOrder = useLibraryStore((state) => state.setSortOrder)

  // Row expansion removed - details now shown in center panel

  // AbortController for cancelling enrichment on filter changes or navigation
  const enrichmentAbortController = useRef(new AbortController())

  // Reset abort controller when filters change
  useEffect(() => {
    enrichmentAbortController.current.abort()
    enrichmentAbortController.current = new AbortController()
  }, [filterMode, semanticFilter, exclusiveFilter, categoryFilter, qualityFilter, statusFilter, searchQuery])

  // Drag-and-drop state for file import
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only accept files
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const audioExtensions = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.webm', '.hda']
    const audioFiles = files.filter(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      return audioExtensions.includes(ext)
    })

    if (audioFiles.length === 0) {
      toast.warning('No Audio Files', 'Only audio files can be imported (.mp3, .wav, .m4a, .ogg, .flac, .webm, .hda)')
      return
    }

    let imported = 0
    let failed = 0
    for (const file of audioFiles) {
      try {
        // file.path is available in Electron renderer (non-sandboxed)
        const filePath = (file as any).path
        if (!filePath) {
          failed++
          continue
        }
        const result = await window.electronAPI.recordings.addExternalByPath(filePath)
        if (result.success) {
          imported++
        } else {
          console.error('Failed to import:', file.name, result.error)
          failed++
        }
      } catch (err) {
        console.error('Failed to import:', file.name, err)
        failed++
      }
    }

    if (imported > 0) {
      await refresh(false)
      const msg = failed > 0
        ? `Imported ${imported} file${imported !== 1 ? 's' : ''}, ${failed} failed.`
        : `Imported ${imported} file${imported !== 1 ? 's' : ''}.`
      toast.success('Files Imported', msg)
    } else if (failed > 0) {
      toast.error('Import Failed', `Failed to import ${failed} file${failed !== 1 ? 's' : ''}.`)
    }
  }, [refresh])

  // View mode persisted in library store (single source of truth for library view mode)
  const viewMode = useLibraryStore((state) => state.viewMode)
  const setViewMode = useLibraryStore((state) => state.setViewMode)
  const compactView = viewMode === 'compact'
  const setCompactView = useCallback((compact: boolean) => {
    setViewMode(compact ? 'compact' : 'card')
  }, [setViewMode])

  // Bulk operations
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 })
  const [deleting, setDeleting] = useState<string | null>(null)

  // B-LIB-006: Confirm dialog state (replaces window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    description: string
    actionLabel: string
    onConfirm: () => void
  }>({ open: false, title: '', description: '', actionLabel: 'Delete', onConfirm: () => {} })

  // Selection for bulk operations
  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    selectAll,
    clearSelection,
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
    // B-LIB-004: Use abort signal to discard stale enrichment results
    const signal = enrichmentAbortController.current.signal

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

        // B-LIB-004: Check abort signal after Promise.all before processing results.
        // If filters changed during the await, discard stale data.
        if (signal.aborted) return

        const newTranscripts = new Map<string, Transcript>(Object.entries(transcriptsObj) as [string, Transcript][])
        const newMeetings = new Map<string, Meeting>(Object.entries(meetingsObj) as [string, Meeting][])

        setTranscripts(newTranscripts)
        setMeetings(newMeetings)
      } catch (e) {
        if (signal.aborted) return
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
        // C-005: Also search in summary and category for better discoverability
        const summary = rec.summary?.toLowerCase() || ''
        const category = rec.category?.toLowerCase() || ''
        return (
          filename.includes(query) ||
          meetingSubject.includes(query) ||
          title.includes(query) ||
          summary.includes(query) ||
          category.includes(query)
        )
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

    // Apply sorting
    const sortMultiplier = sortOrder === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date': {
          const aTime = a.dateRecorded ? new Date(a.dateRecorded).getTime() : 0
          const bTime = b.dateRecorded ? new Date(b.dateRecorded).getTime() : 0
          return (aTime - bTime) * sortMultiplier
        }
        case 'duration':
          return ((a.duration || 0) - (b.duration || 0)) * sortMultiplier
        case 'name':
          return a.filename.localeCompare(b.filename) * sortMultiplier
        case 'quality': {
          // C-005: Use actual quality rating values from KnowledgeCapture type
          const qualityOrder: Record<string, number> = { valuable: 3, archived: 2, 'low-value': 1, unrated: 0 }
          const aQ = qualityOrder[a.quality || ''] ?? -1
          const bQ = qualityOrder[b.quality || ''] ?? -1
          return (aQ - bQ) * sortMultiplier
        }
        default:
          return 0
      }
    })

    return filtered
  }, [recordings, filterMode, semanticFilter, exclusiveFilter, categoryFilter, qualityFilter, statusFilter, deferredSearchQuery, sortBy, sortOrder])

  // Announce filter result changes (after filteredRecordings is declared)
  useEffect(() => {
    if (!loading && filteredRecordings.length !== recordings.length) {
      announce(`Showing ${filteredRecordings.length} of ${recordings.length} captures`)
    }
  }, [filteredRecordings.length, recordings.length, loading, announce])

  // Memoize the list of IDs for keyboard navigation
  const itemIds = useMemo(() => filteredRecordings.map((r) => r.id), [filteredRecordings])

  // C-005: Ref to hold the latest openDetail handler, wired to handleRowClick below
  const openDetailRef = useRef<(id: string) => void>(() => {})

  // Keyboard navigation for accessibility - LB-19 fix: Use focusedIndex and containerRef
  const { handleKeyDown, focusedIndex, containerRef } = useKeyboardNavigation({
    items: itemIds,
    selectedIds,
    expandedIds: new Set<string>(), // No expansion - keep for compatibility
    onToggleSelection: toggleSelection,
    onSelectAll: selectAll,
    onClearSelection: clearSelection,
    onOpenDetail: useCallback((id: string) => openDetailRef.current(id), []), // C-005: Enter opens detail panel
    onToggleExpand: () => {}, // No-op - expansion removed
    onExpandRow: () => {}, // No-op - expansion removed
    onCollapseRow: () => {}, // No-op - expansion removed
    onCollapseAllRows: () => {}, // No-op - expansion removed
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
    toggleTranscriptExpansion(id)
  }, [toggleTranscriptExpansion])

  const openRecordingsFolder = async () => {
    await window.electronAPI.storage.openFolder('recordings')
  }

  const handleDownload = useCallback(
    async (recording: UnifiedRecording) => {
      if (!deviceConnected) return
      await queueDownload(recording)
    },
    [deviceConnected, queueDownload]
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
    if (!deviceConnected) return
    const deviceOnlyRecordings = filteredRecordings.filter((r) => isDeviceOnly(r))
    await queueBulkDownloads(deviceOnlyRecordings)
  }

  const handleBulkProcess = async () => {
    const needsProcessing = filteredRecordings.filter(
      (r) => hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    )
    if (needsProcessing.length === 0) return

    setBulkProcessing(true)
    setBulkProgress({ current: 0, total: needsProcessing.length })

    try {
      await queueBulkTranscriptions(needsProcessing)
      await refresh(false)
    } finally {
      setBulkProcessing(false)
      setBulkProgress({ current: 0, total: 0 })
    }
  }

  // Selection-based bulk operations
  const handleSelectedDownload = useCallback(async () => {
    if (!deviceConnected) return
    const selectedRecordings = filteredRecordings.filter((r) => selectedIds.has(r.id) && isDeviceOnly(r))
    const queued = await queueBulkDownloads(selectedRecordings)
    if (queued > 0) clearSelection()
  }, [filteredRecordings, selectedIds, deviceConnected, clearSelection, queueBulkDownloads])

  const handleSelectedProcess = useCallback(async () => {
    const selectedRecordings = filteredRecordings.filter(
      (r) => selectedIds.has(r.id) && hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    )
    if (selectedRecordings.length === 0) return

    setBulkProcessing(true)
    setBulkProgress({ current: 0, total: selectedRecordings.length })

    try {
      const queued = await queueBulkTranscriptions(selectedRecordings)
      await refresh(false)
      if (queued > 0) clearSelection()
    } finally {
      setBulkProcessing(false)
      setBulkProgress({ current: 0, total: 0 })
    }
  }, [filteredRecordings, selectedIds, refresh, clearSelection, queueBulkTranscriptions])

  // B-LIB-006: Extracted bulk delete execution (called after confirmation)
  const executeBulkDelete = useCallback(async (selectedRecordings: UnifiedRecording[]) => {
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

      // Step 4: Show summary to user via toast if errors
      if (errors.length > 0) {
        import('@/components/ui/toaster').then(({ toast }) => {
          toast.warning('Partial Delete', `Deleted ${successCount} of ${selectedRecordings.length} items. ${errors.length} failed.`)
        })
      }
    } finally {
      setBulkProcessing(false)
      setBulkProgress({ current: 0, total: 0 })
    }
  }, [refresh, clearSelection])

  // PESSIMISTIC UPDATE: Server-first bulk delete with confirmation dialog
  const handleSelectedDelete = useCallback(async () => {
    const selectedRecordings = filteredRecordings.filter((r) => selectedIds.has(r.id))
    if (selectedRecordings.length === 0) return

    const hasLocalFiles = selectedRecordings.some((r) => hasLocalPath(r))
    const hasDeviceFiles = selectedRecordings.some((r) => isDeviceOnly(r))

    let description = `Delete ${selectedRecordings.length} selected item${selectedRecordings.length > 1 ? 's' : ''}?`
    if (hasLocalFiles && hasDeviceFiles) {
      description += ' This includes both local files and device recordings.'
    } else if (hasLocalFiles) {
      description += ' This will remove local files and any transcripts.'
    } else {
      description += ' This cannot be undone.'
    }

    setConfirmDialog({
      open: true,
      title: 'Delete Selected Items',
      description,
      actionLabel: 'Delete',
      onConfirm: () => executeBulkDelete(selectedRecordings)
    })
  }, [filteredRecordings, selectedIds, executeBulkDelete])

  // B-LIB-006: Extracted device delete execution
  const executeDeleteFromDevice = useCallback(async (recording: UnifiedRecording) => {
    setDeleting(recording.id)
    try {
      await window.electronAPI.recordings.delete(recording.id)
      await refresh(false)
    } catch (e) {
      console.error('Failed to delete from device:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error('Delete Failed', `Failed to delete "${recording.filename}" from device. Please try again.`)
      })
    } finally {
      setDeleting(null)
    }
  }, [refresh])

  // PESSIMISTIC UPDATE: Server-first delete with confirmation dialog
  const handleDeleteFromDevice = useCallback(async (recording: UnifiedRecording) => {
    if (!deviceConnected) return
    if (!('deviceFilename' in recording)) return

    setConfirmDialog({
      open: true,
      title: 'Delete from Device',
      description: `Delete "${recording.filename}" from device? This cannot be undone.`,
      actionLabel: 'Delete',
      onConfirm: () => executeDeleteFromDevice(recording)
    })
  }, [deviceConnected, executeDeleteFromDevice])

  // B-LIB-006: Extracted local delete execution
  const executeDeleteLocal = useCallback(async (recording: UnifiedRecording) => {
    setDeleting(recording.id)
    try {
      await window.electronAPI.recordings.delete(recording.id)
      await refresh(false)
    } catch (e) {
      console.error('Failed to delete local file:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error('Delete Failed', `Failed to delete "${recording.filename}". Please try again.`)
      })
    } finally {
      setDeleting(null)
    }
  }, [refresh])

  // PESSIMISTIC UPDATE: Server-first delete with confirmation dialog
  const handleDeleteLocal = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) return
    const hasTranscript = transcripts.has(recording.id)
    const description = hasTranscript
      ? `Delete local file and transcript for "${recording.filename}"? The transcript data will be lost.`
      : `Delete local file "${recording.filename}"?`

    setConfirmDialog({
      open: true,
      title: 'Delete Local File',
      description,
      actionLabel: 'Delete',
      onConfirm: () => executeDeleteLocal(recording)
    })
  }, [transcripts, executeDeleteLocal])

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
    // TODO: Consider allowing background audio playback while browsing rows.
    // Currently stops any playing audio aggressively on every row click.
    audioControls.stop()
    setSelectedSourceId(recording.id)

    // Load waveform if recording has local file (skip if already loaded for this recording)
    const { waveformLoadedForId } = useUIStore.getState()
    if (hasLocalPath(recording) && waveformLoadedForId !== recording.id) {
      audioControls.loadWaveformOnly(recording.id, recording.localPath)
    }
  }, [setSelectedSourceId, audioControls])

  // C-005: Keep openDetailRef in sync with handleRowClick + filteredRecordings
  openDetailRef.current = (id: string) => {
    const recording = filteredRecordings.find((r) => r.id === id)
    if (recording) {
      handleRowClick(recording)
    }
  }

  // Get selected recording and its data for SourceReader
  const selectedRecording = selectedSourceId ? recordings.find((r) => r.id === selectedSourceId) : null
  const selectedTranscript = selectedRecording ? transcripts.get(selectedRecording.id) : undefined
  const selectedMeeting = selectedRecording?.meetingId ? meetings.get(selectedRecording.meetingId) : undefined

  // Virtualization setup
  const parentRef = useRef<HTMLDivElement>(null)

  // B-LIB-008: Simplified estimateSize — complex calculations caused unnecessary
  // virtualizer re-measurements. The virtualizer uses measureElement for actual sizing.
  const estimateSize = useCallback(
    () => compactView ? 48 : 200,
    [compactView]
  )

  const rowVirtualizer = useVirtualizer({
    count: filteredRecordings.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5
  })

  // Loading state — show skeleton layout instead of bare spinner
  if (loading && recordings.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <header className="border-b px-6 py-4">
          <h1 className="text-2xl font-bold">Knowledge Library</h1>
          <p className="text-sm text-muted-foreground">Loading your captured conversations...</p>
        </header>
        {/* Skeleton filter bar */}
        <div className="px-6 py-4 flex gap-3">
          <div className="h-8 w-24 rounded-md bg-muted animate-pulse" />
          <div className="h-8 w-32 rounded-md bg-muted animate-pulse" />
          <div className="h-8 w-28 rounded-md bg-muted animate-pulse" />
          <div className="h-8 flex-1 max-w-xs rounded-md bg-muted animate-pulse" />
        </div>
        {/* Skeleton rows */}
        <div className="flex-1 overflow-hidden px-6 py-2 space-y-3" aria-busy="true" aria-label="Loading recordings">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <div className="h-5 w-5 rounded bg-muted animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-7 w-7 rounded bg-muted animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-lg font-medium text-primary">Drop audio files to import</p>
            <p className="text-sm text-muted-foreground mt-1">Supported: .mp3, .wav, .m4a, .ogg, .flac, .webm, .hda</p>
          </div>
        </div>
      )}

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
      <div className="px-2 sm:px-4 lg:px-6 relative">
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
            sortBy={sortBy}
            sortOrder={sortOrder}
            onFilterModeChange={setFilterMode}
            onSemanticFilterChange={setSemanticFilter}
            onExclusiveFilterChange={setExclusiveFilter}
            onCategoryFilterChange={(filter) => setCategoryFilter(filter === 'all' ? null : filter)}
            onQualityFilterChange={(filter) => setQualityFilter(filter === 'all' ? null : filter)}
            onStatusFilterChange={(filter) => setStatusFilter(filter === 'all' ? null : filter)}
            onSearchQueryChange={setSearchQuery}
            onSortByChange={setSortBy}
            onSortOrderChange={setSortOrder}
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
            /* Left Panel: Recording List - LB-19 fix: Add containerRef for keyboard navigation */
            <div
              ref={(el) => {
                // @ts-expect-error - Ref callback pattern for multiple refs
                parentRef.current = el
                // @ts-expect-error - Ref callback pattern for multiple refs
                containerRef.current = el
              }}
              className="h-full overflow-auto p-2 sm:p-4 lg:p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset"
              onKeyDown={handleKeyDown}
              tabIndex={0}
              role="application"
              aria-label="Recording list navigation. Use arrow keys to navigate, Space to select, Enter to open."
              data-testid="library-list"
            >
        <div className={`lg:max-w-4xl lg:mx-auto transition-opacity ${isFilterPending ? 'opacity-60' : 'opacity-100'}`}>
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
                // Compact List View - LB-19 fix: Add focus indicator support
                <div key="compact-view" className="border rounded-lg overflow-hidden">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = filteredRecordings[virtualRow.index]
                    const meeting = recording.meetingId ? meetings.get(recording.meetingId) : undefined
                    const isFocused = focusedIndex === virtualRow.index

                    return (
                      <div
                        key={recording.id}
                        data-index={virtualRow.index}
                        data-focus-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`
                        }}
                        className={[
                          virtualRow.index > 0 ? 'border-t' : '',
                          isFocused ? 'ring-2 ring-primary ring-inset' : ''
                        ].join(' ')}
                        aria-rowindex={virtualRow.index + 1}
                      >
                        <SourceRow
                          recording={recording}
                          meeting={meeting}
                          transcript={transcripts.get(recording.id)}
                          isPlaying={currentlyPlayingId === recording.id}
                          isSelected={selectedIds.has(recording.id)}
                          isActiveSource={selectedSourceId === recording.id}
                          searchQuery={deferredSearchQuery}
                          onSelectionChange={(id, shiftKey) =>
                            handleSelectionClick(id, shiftKey, filteredRecordings.map((r) => r.id))
                          }
                          onClick={() => handleRowClick(recording)}
                          onPlay={() => {
                            if (hasLocalPath(recording)) {
                              setSelectedSourceId(recording.id)
                              handlePlayCallback(recording.id, recording.localPath)
                            }
                          }}
                          onStop={handleStopCallback}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                // Card View - LB-19 fix: Add focus indicator support
                <div key="card-view" className="space-y-4">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = filteredRecordings[virtualRow.index]
                    const transcript = transcripts.get(recording.id)
                    const meeting = recording.meetingId ? meetings.get(recording.meetingId) : undefined
                    const isFocused = focusedIndex === virtualRow.index

                    return (
                      <div
                        key={recording.id}
                        data-index={virtualRow.index}
                        data-focus-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`
                        }}
                        className={isFocused ? 'ring-2 ring-primary rounded-lg' : ''}
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
                          isSelected={selectedIds.has(recording.id)}
                          onSelectionChange={(id, shiftKey) =>
                            handleSelectionClick(id, shiftKey, filteredRecordings.map((r) => r.id))
                          }
                          onClick={() => handleRowClick(recording)}
                          onPlay={() => {
                            if (hasLocalPath(recording)) {
                              setSelectedSourceId(recording.id)
                              handlePlayCallback(recording.id, recording.localPath)
                            }
                          }}
                          onStop={handleStopCallback}
                          onDownload={() => handleDownloadCallback(recording)}
                          onDelete={() => handleDeleteCallback(recording)}
                          onTranscribe={() => queueTranscription(recording)}
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
              meeting={selectedMeeting}
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
              // Action button callbacks
              onDownload={() => {
                if (selectedRecording) handleDownloadCallback(selectedRecording)
              }}
              onTranscribe={() => {
                if (selectedRecording) queueTranscription(selectedRecording)
              }}
              onDelete={() => {
                if (selectedRecording) handleDeleteCallback(selectedRecording)
              }}
              // State for button disabling
              deviceConnected={deviceConnected}
              isDownloading={selectedRecording && isDeviceOnly(selectedRecording)
                ? isDownloading(selectedRecording.deviceFilename)
                : false}
              downloadProgress={selectedRecording && isDeviceOnly(selectedRecording)
                ? downloadQueue.get(selectedRecording.deviceFilename)?.progress
                : undefined}
              isDeleting={selectedRecording ? deleting === selectedRecording.id : false}
              // Navigation
              onNavigateToMeeting={handleNavigateToMeeting}
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

      {/* B-LIB-006: Confirm Dialog for destructive actions */}
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        actionLabel={confirmDialog.actionLabel}
        variant="destructive"
        onConfirm={confirmDialog.onConfirm}
      />
    </div>
  )
}

export default Library
