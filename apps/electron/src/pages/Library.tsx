import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RefreshCw, AlertCircle, EyeOff, Trash2 } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import {
  UnifiedRecording,
  hasLocalPath,
  isDeviceOnly,
  matchesSemanticFilter,
  matchesExclusiveFilter
} from '@/types/unified-recording'
import { Transcript, Meeting } from '@/types'
import type { QualityRating } from '@/types/knowledge'
import { useAudioControls } from '@/components/OperationController'
import { useUIStore } from '@/store/useUIStore'
import { useDownloadQueue } from '@/store/useAppStore'
import {
  LibraryHeader,
  LibraryFilters,
  SourceRow,
  SourceCard,
  StatusLegend,
  EmptyState,
  DeviceDisconnectBanner,
  BulkActionsBar,
  LiveRegion,
  useAnnouncement,
  TriPaneLayout,
  SourceReader,
  AssistantPanel,
  DeletePermanentDialog,
  type DeletePermanentDialogImpact
} from '@/features/library/components'
import { useSourceSelection, useKeyboardNavigation, useTransitionFilters, useValueSuggestionToasts } from '@/features/library/hooks'
import { buildSearchCorpus } from '@/features/library/utils/buildSearchCorpus'
import { getSourceType, matchesSourceTypeFilter } from '@/features/library/utils/sourceType'
import { matchesDurationPreset } from '@/features/library/utils/durationFilter'
import { trashRowToUnified } from '@/features/library/utils/trashRow'
import type { DatabaseRecording } from '@/hooks/useUnifiedRecordings'
import {
  softDeleteConfirmDescription,
  deviceDeleteConfirmDescription,
  LABEL_MOVE_TO_TRASH,
  LABEL_DELETE_FROM_DEVICE,
  TRASH_MODE_BANNER,
  FAILURE_NOTHING_DELETED_TITLE,
  graphCleanupFailedBody,
  genericPermanentDeleteFailedBody,
  LABEL_DELETE_ANYWAY_SKIP_GRAPH,
  DEVICE_COPY_REMAINS_TITLE,
  deviceCopyRemainsBody,
  FILES_PENDING_TITLE,
  filesPendingBody,
  COMBINED_PARTIAL_TITLE,
  combinedPartialBody,
  VIEW_MAY_BE_STALE_NOTE,
  actualRemovalSummary
} from '@/features/library/utils/deletionCopy'
import type { TypeCounts } from '@/features/library/components/LibraryFilters'
import { useLibraryStore, useLibrarySorting } from '@/store/useLibraryStore'
import { useOperations } from '@/hooks/useOperations'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export function Library() {
  const navigate = useNavigate()
  const location = useLocation()
  const { recordings, loading, error, refresh, refreshLocal, deviceConnected, stats } = useUnifiedRecordings()

  // Selected source for center panel
  const selectedSourceId = useLibraryStore((state) => state.selectedSourceId)
  const setSelectedSourceId = useLibraryStore((state) => state.setSelectedSourceId)

  // Centralized operations (downloads + transcriptions)
  const {
    queueTranscription,
    reprocessWithVibeVoice,
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

  // F16/spec-003 Part F — coalesced live-classification suggestion toasts.
  // Mounted once here (the Library page). The backfill runner never emits
  // these events (progress/summary only), so a large batch can't spam it.
  useValueSuggestionToasts({
    refresh,
    onReview: () => setQualityFilter('low-value')
  })

  // Source-type + duration filters (new) — read/set directly from the store.
  const sourceTypeFilter = useLibraryStore((state) => state.sourceTypeFilter)
  const setSourceTypeFilter = useLibraryStore((state) => state.setSourceTypeFilter)
  const durationPreset = useLibraryStore((state) => state.durationPreset)
  const setDurationPreset = useLibraryStore((state) => state.setDurationPreset)
  const clearAllFilters = useLibraryStore((state) => state.clearFilters)


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
  }, [filterMode, semanticFilter, exclusiveFilter, categoryFilter, qualityFilter, statusFilter, sourceTypeFilter, durationPreset, searchQuery])

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
  // Personal ("ignored") recordings are hidden from the Library by default; this
  // chip reveals them (they still never enter AI processing). (v38)
  const [showPersonal, setShowPersonal] = useState(false)

  // B-LIB-006: Confirm dialog state (replaces window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    description: string
    actionLabel: string
    onConfirm: () => void
  }>({ open: false, title: '', description: '', actionLabel: 'Delete', onConfirm: () => {} })

  // spec-005/F17 T5 §D6 — the permanent-delete flow gets its OWN dialog state
  // (impact copy + device checkbox have no slot in the shared confirmDialog above).
  const [deletePermanentDialog, setDeletePermanentDialog] = useState<{
    open: boolean
    recording: UnifiedRecording | null
    impact?: DeletePermanentDialogImpact
  }>({ open: false, recording: null })

  // spec-005/F17 T5 §D1 — Trash is a view-mode swap, not a filter: soft-deleted
  // rows are excluded at the DB layer and never enter useUnifiedRecordings.
  // Deliberately transient/local (never persisted) so the app never boots into
  // Trash. trashedRecordings is loaded eagerly (for the count) independently of
  // showTrash (see loadTrash below).
  const [showTrash, setShowTrash] = useState(false)
  const [trashedRecordings, setTrashedRecordings] = useState<UnifiedRecording[]>([])

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

  // One-shot backfill: populate recordings.duration_seconds (NULL on the
  // download/import paths) from device-cache + transcript timing already in the
  // DB, and mark clearly-junk captures low-value. Idempotent server-side. Runs
  // once per mount, after the first data load, then refreshes so the newly
  // persisted durations/ratings drive sort/filter even when offline.
  const backfillRanRef = useRef(false)
  useEffect(() => {
    if (backfillRanRef.current) return
    if (loading || recordings.length === 0) return
    if (!window.electronAPI?.recordings?.backfillDurations) return
    backfillRanRef.current = true
    void (async () => {
      try {
        const result = await window.electronAPI.recordings.backfillDurations()
        if (result?.success && ((result.updated ?? 0) > 0 || (result.markedLowValue ?? 0) > 0)) {
          await refresh(false)
        }
      } catch (e) {
        console.error('[Library] Duration backfill failed:', e)
      }
    })()
  }, [loading, recordings.length, refresh])

  // spec-005/F17 T5 §D1 — loads the Trash *data* (for the toggle's count),
  // independent of *entering* Trash (showTrash). Cheap: idx_recordings_deleted_at
  // exists and tombstones are few. Re-run after every soft-delete, restore, and
  // permanent-delete so the count + the visible Trash list stay accurate.
  const loadTrash = useCallback(async () => {
    try {
      const rows = (await window.electronAPI.recordings.getTrash()) as DatabaseRecording[]
      // Order preservation (§D5): getTrashedRecordings() returns newest-tombstone-
      // first; map with a plain .map() — do NOT re-sort (buildRecordingMap sorts
      // by dateRecorded, which would break that ordering).
      setTrashedRecordings(rows.map(trashRowToUnified))
    } catch (e) {
      console.error('[Library] Failed to load trash:', e)
      setTrashedRecordings([])
    }
    // spec-006/F17 T6 AR3-2 — piggyback a bounded, non-fatal sweep of any
    // pending post-commit file-cleanup backlog on every Trash-view-entry
    // load. Deliberately fire-and-forget: never awaited, never lets a
    // missing/throwing IPC (older preload, a test harness that doesn't stub
    // it) affect the Trash list itself.
    try {
      void window.electronAPI?.recordings?.retryPendingCleanups?.()?.catch((e: unknown) => {
        console.error('[Library] Pending-cleanup retry sweep failed:', e)
      })
    } catch (e) {
      console.error('[Library] Pending-cleanup retry sweep failed:', e)
    }
  }, [])

  useEffect(() => {
    loadTrash()
  }, [loadTrash])

  // Toggling Trash mode also clears bulk selection — Trash rows never wire
  // onSelectionChange (D1), so a stale "N selected" bulk bar would otherwise
  // persist from whatever was checked in the live list before the toggle.
  const handleToggleTrash = useCallback(() => {
    setShowTrash((prev) => !prev)
    clearSelection()
  }, [clearSelection])

  // Enrichment: Load transcripts and meetings for recordings
  const [transcripts, setTranscripts] = useState<Map<string, Transcript>>(new Map())
  const [meetings, setMeetings] = useState<Map<string, Meeting>>(new Map())

  const refreshCompletedTranscription = useCallback(async (recordingId: string) => {
    try {
      await refresh(false)

      const transcriptsObj = await window.electronAPI.transcripts.getByRecordingIds([recordingId])
      const transcript = transcriptsObj?.[recordingId]
      if (!transcript) return

      setTranscripts((previous) => {
        const next = new Map(previous)
        next.set(recordingId, transcript)
        return next
      })
    } catch (e) {
      console.error('[Library] Failed to refresh completed transcription:', e)
    }
  }, [refresh])

  useEffect(() => {
    const unsubscribers: Array<() => void> = []

    if (window.electronAPI.onTranscriptionCompleted) {
      unsubscribers.push(window.electronAPI.onTranscriptionCompleted((data) => {
        void refreshCompletedTranscription(data.recordingId)
      }))
    }

    if (window.electronAPI.onTranscriptionFailed) {
      unsubscribers.push(window.electronAPI.onTranscriptionFailed(() => {
        void refresh(false)
      }))
    }

    if (window.electronAPI.onTranscriptionCancelled) {
      unsubscribers.push(window.electronAPI.onTranscriptionCancelled(() => {
        void refresh(false)
      }))
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [refresh, refreshCompletedTranscription])

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

        // H7 FIX: Merge into the previous maps instead of replacing them wholesale.
        // A refresh (or a background calendar sync that momentarily starves the main
        // process) can return a transient subset — or briefly empty — enrichment
        // result. Replacing the map on every load made the calendar/meeting chip and
        // other meeting-derived chrome flicker or vanish mid-refresh. Merging keeps
        // last-known meeting/transcript data on the rows so the chrome stays stable.
        setTranscripts((prev) => {
          const merged = new Map(prev)
          for (const [id, t] of newTranscripts) merged.set(id, t)
          return merged
        })
        setMeetings((prev) => {
          const merged = new Map(prev)
          for (const [id, m] of newMeetings) merged.set(id, m)
          return merged
        })
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

  // Stage 1: base population — location + personal visibility only. This is the
  // set the source-type segmented control counts describe.
  const baseRecordings = useMemo(() => {
    return recordings.filter((rec) => {
      const locationMatches =
        filterMode === 'semantic'
          ? matchesSemanticFilter(rec.location, semanticFilter)
          : matchesExclusiveFilter(rec.location, exclusiveFilter)
      if (!locationMatches) return false
      if (rec.personal && !showPersonal) return false
      return true
    })
  }, [recordings, filterMode, semanticFilter, exclusiveFilter, showPersonal])

  // Per-type counts for the segmented control (over the location-scoped base).
  const typeCounts = useMemo<TypeCounts>(() => {
    const counts: TypeCounts = { all: baseRecordings.length, audio: 0, image: 0, pdf: 0, note: 0 }
    for (const rec of baseRecordings) {
      const type = getSourceType(rec)
      if (type === 'audio') counts.audio++
      else if (type === 'image') counts.image++
      else if (type === 'pdf') counts.pdf++
      else if (type === 'note' || type === 'data') counts.note++
    }
    return counts
  }, [baseRecordings])

  // Whether any capture is actually rated — drives the honest Quality empty state.
  const ratedCount = useMemo(
    () => recordings.filter((r) => r.quality && r.quality !== 'unrated').length,
    [recordings]
  )

  // Stage 2: scoped set — apply source-type, duration, category, quality, status
  // (everything EXCEPT the list search). filterableCount = this length.
  const scopedRecordings = useMemo(() => {
    return baseRecordings.filter((rec) => {
      if (!matchesSourceTypeFilter(getSourceType(rec), sourceTypeFilter)) return false
      if (!matchesDurationPreset(rec, durationPreset)) return false
      if (categoryFilter !== null && rec.category !== categoryFilter) return false
      if (qualityFilter !== null && rec.quality !== qualityFilter) return false
      if (statusFilter !== null && rec.status !== statusFilter) return false
      return true
    })
  }, [baseRecordings, sourceTypeFilter, durationPreset, categoryFilter, qualityFilter, statusFilter])

  // Filter recordings based on scoped set + search, then sort.
  const filteredRecordings = useMemo(() => {
    const filtered = scopedRecordings.filter((rec) => {
      if (deferredSearchQuery) {
        const tokens = deferredSearchQuery
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 0)
        const meeting = rec.meetingId ? meetings.get(rec.meetingId) : undefined
        const transcript = transcripts.get(rec.id)
        const corpus = buildSearchCorpus(rec, meeting, transcript)
        if (!tokens.every((token) => corpus.includes(token))) return false
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
          // F16/spec-003: garbage made explicit (was an implicit ?? -1 fallback) —
          // still sorts last, but no longer relies on an unlisted key falling through.
          const qualityOrder: Record<string, number> = { valuable: 4, archived: 3, unrated: 2, 'low-value': 1, garbage: 0 }
          const aQ = qualityOrder[a.quality || ''] ?? -1
          const bQ = qualityOrder[b.quality || ''] ?? -1
          return (aQ - bQ) * sortMultiplier
        }
        default:
          return 0
      }
    })

    return filtered
  }, [scopedRecordings, deferredSearchQuery, meetings, transcripts, sortBy, sortOrder])

  // Count of personal ("ignored") recordings, to decide whether to show the chip.
  const personalCount = useMemo(() => recordings.filter((r) => r.personal).length, [recordings])

  // spec-005/F17 T5 §D1 — the SINGLE swap point: whatever is actually displayed,
  // in Trash mode or not. Every consumer that indexes into "the currently shown
  // list" (virtualizer count/estimateSize, the render map, itemIds, the
  // reveal-on-open findIndex) reads THIS, never filteredRecordings/trashedRecordings
  // directly — swapping only one of them would desync indices (spec's hazard note).
  const displayedRecordings = showTrash ? trashedRecordings : filteredRecordings

  // Announce filter result changes (after filteredRecordings is declared)
  useEffect(() => {
    if (!loading && filteredRecordings.length !== recordings.length) {
      announce(`Showing ${filteredRecordings.length} of ${recordings.length} captures`)
    }
  }, [filteredRecordings.length, recordings.length, loading, announce])

  // Memoize the list of IDs for keyboard navigation
  const itemIds = useMemo(() => displayedRecordings.map((r) => r.id), [displayedRecordings])

  // Are all currently-shown rows selected? Drives the header select-all/deselect-all
  // toggle label + behavior. Only meaningful once selection mode is active.
  const allShownSelected = useMemo(
    () => filteredRecordings.length > 0 && filteredRecordings.every((r) => selectedIds.has(r.id)),
    [filteredRecordings, selectedIds]
  )

  // Header toggle: select every shown row, or clear when they're all already selected.
  const toggleSelectAllShown = useCallback(() => {
    if (allShownSelected) {
      clearSelection()
    } else {
      selectAll(filteredRecordings.map((r) => r.id))
    }
  }, [allShownSelected, clearSelection, selectAll, filteredRecordings])

  // C-005: Ref to hold the latest openDetail handler, wired to handleRowClick below
  const openDetailRef = useRef<(id: string) => void>(() => {})

  // CX-T5-1 (spec-005 fix round): bulk selection has no meaning in Trash —
  // trash rows never wire onSelectionChange, and BulkActionsBar's handlers all
  // operate on filteredRecordings (the LIVE list), so a Space/Ctrl+A selection
  // made in Trash would show misleading counts over no-op actions. Gate the
  // selection-mutating keyboard shortcuts on !showTrash (arrow/Home/End/Enter
  // navigation stays available); the bulk bar itself is hidden below.
  const guardedToggleSelection = useCallback((id: string) => {
    if (showTrash) return
    toggleSelection(id)
  }, [showTrash, toggleSelection])

  const guardedSelectAll = useCallback((ids: string[]) => {
    if (showTrash) return
    selectAll(ids)
  }, [showTrash, selectAll])

  // Keyboard navigation for accessibility - LB-19 fix: Use focusedIndex and containerRef
  const { handleKeyDown, focusedIndex, containerRef } = useKeyboardNavigation({
    items: itemIds,
    selectedIds,
    expandedIds: new Set<string>(), // No expansion - keep for compatibility
    onToggleSelection: guardedToggleSelection,
    onSelectAll: guardedSelectAll,
    onClearSelection: clearSelection,
    onOpenDetail: useCallback((id: string) => openDetailRef.current(id), []), // C-005: Enter opens detail panel
    onToggleExpand: () => {}, // No-op - expansion removed
    onExpandRow: () => {}, // No-op - expansion removed
    onCollapseRow: () => {}, // No-op - expansion removed
    onCollapseAllRows: () => {}, // No-op - expansion removed
    isEnabled: displayedRecordings.length > 0
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

  const handleImportFile = async () => {
    try {
      const result = await window.electronAPI.artifacts.pickAndImport()
      if (result.success) {
        if (result.data.length > 0) await refresh(false)
      } else {
        console.error('Failed to import file:', result.error)
      }
    } catch (e) {
      console.error('Failed to import file:', e)
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
    const deletedIds = new Set<string>()

    try {
      // Step 1: Delete all recordings on server FIRST.
      // Device-only entries have a synthetic (non-UUID) id and no local file —
      // recordings.delete() silently no-ops for them, so they must be deleted
      // over USB by device filename instead.
      const deviceService = getHiDockDeviceService()
      for (let i = 0; i < selectedRecordings.length; i++) {
        const recording = selectedRecordings[i]
        setBulkProgress({ current: i + 1, total: selectedRecordings.length })

        try {
          if (isDeviceOnly(recording)) {
            const ok = await deviceService.deleteRecording(recording.deviceFilename)
            if (!ok) throw new Error('Device deletion failed')
          } else {
            // Soft cascade delete: hides + pulls from AI, restorable, no data leak.
            const res = await window.electronAPI.recordings.deleteCascade(recording.id, false)
            if (!res?.success) throw new Error(res?.error || 'Delete failed')
          }
          deletedIds.add(recording.id)
        } catch (e) {
          console.error('Failed to delete:', recording.filename, e)
          errors.push({ filename: recording.filename, error: e })
        }
      }

      // Step 2: Refresh data from server to update UI (only if some deletions succeeded)
      const successCount = selectedRecordings.length - errors.length
      if (successCount > 0) {
        await refresh(false)
        // CX-T5-2 (spec-005 fix round): bulk soft-deletes just moved rows into
        // Trash — reload it so the "Trash (N)" badge and (if open) the Trash
        // list don't go stale, same as every single-item delete path.
        await loadTrash()
        // OP-F-LOW-4 (AR3-5 parity with executeDeleteLocal): if one of the
        // deleted rows was playing or selected in the reader, stop/clear
        // immediately rather than leaving audio of a tombstoned row running.
        if (currentlyPlayingId && deletedIds.has(currentlyPlayingId)) {
          audioControls.stop()
        }
        if (selectedSourceId && deletedIds.has(selectedSourceId)) {
          setSelectedSourceId(null)
        }
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
  }, [refresh, loadTrash, clearSelection, currentlyPlayingId, audioControls, selectedSourceId, setSelectedSourceId])

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

  // Bulk "mark personal" — flags every eligible (non device-only) selected
  // recording as ignored. Reversible per-row afterwards.
  const handleSelectedMarkPersonal = useCallback(async () => {
    const targets = filteredRecordings.filter((r) => selectedIds.has(r.id) && !isDeviceOnly(r))
    if (targets.length === 0) return
    let ok = 0
    for (const rec of targets) {
      try {
        const res = await window.electronAPI.recordings.markPersonal(rec.id, true)
        if (res?.success) ok++
      } catch (e) {
        console.error('Failed to mark personal:', rec.filename, e)
      }
    }
    if (ok > 0) await refresh(false)
    clearSelection()
    import('@/components/ui/toaster').then(({ toast }) => {
      toast.success('Marked personal', `${ok} recording${ok > 1 ? 's' : ''} excluded from AI processing and default views.`)
    })
  }, [filteredRecordings, selectedIds, refresh, clearSelection])

  // B-LIB-006: Extracted device delete execution.
  // Deletes over USB by device filename — recordings.delete() only removes the
  // LOCAL file and silently no-ops on device-only synthetic ids, so it must
  // never be the device-deletion path.
  const executeDeleteFromDevice = useCallback(async (recording: UnifiedRecording) => {
    if (!('deviceFilename' in recording)) return
    setDeleting(recording.id)
    try {
      const ok = await getHiDockDeviceService().deleteRecording(recording.deviceFilename)
      if (!ok) throw new Error('Device deletion failed')
      // Local copies are intentionally kept — the next device scan reconciles
      // the row to local-only via markRecordingsNotOnDevice.
      await refresh(false)
      // spec-005/F17 T5 §D2 — device delete previously only ever toasted on
      // error; a real removal now confirms success too.
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.success('Removed from device', `"${recording.filename}" was erased from the HiDock.`)
      })
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
      title: LABEL_DELETE_FROM_DEVICE,
      description: deviceDeleteConfirmDescription(recording.filename),
      actionLabel: LABEL_DELETE_FROM_DEVICE,
      onConfirm: () => executeDeleteFromDevice(recording)
    })
  }, [deviceConnected, executeDeleteFromDevice])

  // Soft delete (default): hide the recording (restorable) and pull it from every
  // AI pipeline + surface. Nothing is removed from disk until "Delete permanently".
  const executeDeleteLocal = useCallback(async (recording: UnifiedRecording) => {
    setDeleting(recording.id)
    try {
      const res = await window.electronAPI.recordings.deleteCascade(recording.id, false)
      if (!res?.success) throw new Error(res?.error || 'Delete failed')
      await refresh(false)
      // spec-005/F17 T5 §D1 step 7 — keep the Trash count accurate after every
      // soft-delete (this row just became visible there).
      await loadTrash()
      // AR3-5 — soft-deleting a playing/selected row stops playback and clears
      // its reader/selection immediately (don't wait for the Trash-entry effect).
      if (currentlyPlayingId === recording.id) audioControls.stop()
      if (selectedSourceId === recording.id) setSelectedSourceId(null)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.success('Moved to Trash', `"${recording.filename}" is hidden and excluded from processing.`, {
          duration: 8000,
          action: {
            label: 'Undo',
            onClick: async () => {
              await window.electronAPI.recordings.restore(recording.id)
              await refresh(false)
              await loadTrash()
            }
          }
        })
      })
    } catch (e) {
      console.error('Failed to delete local file:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error('Delete Failed', `Failed to delete "${recording.filename}". Please try again.`)
      })
    } finally {
      setDeleting(null)
    }
  }, [refresh, loadTrash, currentlyPlayingId, audioControls, selectedSourceId, setSelectedSourceId])

  // Soft-delete flow: a light confirm, then hide with an Undo toast (reversible).
  const handleDeleteLocal = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) return
    setConfirmDialog({
      open: true,
      title: LABEL_MOVE_TO_TRASH,
      description: softDeleteConfirmDescription(recording.filename),
      actionLabel: LABEL_MOVE_TO_TRASH,
      onConfirm: () => executeDeleteLocal(recording)
    })
  }, [executeDeleteLocal])

  // Hard purge (privacy): irreversibly remove ALL derived data + files. Impact +
  // strings are owned by the dedicated DeletePermanentDialog (§D6). T6
  // (spec-006) implements D2/D3/D5 + the AR3-2/AR3-3(c)/AR3-6(a,b) amendments:
  //  1. Local purge FIRST (D3 step 1). A failure — including the AR3-1
  //     fail-closed graph refusal, surfaced as `graphUnavailable` — is honest:
  //     nothing was deleted, and the graph-refusal case offers the AR3-3(c)
  //     escape hatch as an explicit toast action (re-invokes this function
  //     with skipGraphCleanup:true — a second, user-initiated call).
  //  2. Only on a successful local purge does the device branch run
  //     (D3 step 2). AR3-6(a): the checkbox's intent is re-validated against
  //     LIVE signals at EXECUTE time (deviceConnected, and a real device
  //     filename) — a stale/disconnected state never silently claims success.
  //     AR3-6(b): a confirmed device delete immediately reconciles on_device
  //     locally so the UI doesn't show a stale 'both' row before the next scan.
  //  3. AR3-2: the local purge's own file-cleanup outcome (allFilesRemoved/
  //     pendingFileKinds) also gates the completion toast — success is only
  //     claimed when everything was actually confirmed removed.
  // impact.deviceFilename (F-INFO-6) is preferred over the UnifiedRecording's
  // own field, since a Trash row's UnifiedRecording never carries one at all.
  const executeDeletePermanent = useCallback(async (
    recording: UnifiedRecording,
    opts?: { alsoDeleteFromDevice: boolean; skipGraphCleanup?: boolean },
    impact?: DeletePermanentDialogImpact
  ) => {
    setDeleting(recording.id)
    try {
      const res = opts?.skipGraphCleanup
        ? await window.electronAPI.recordings.deleteCascade(recording.id, true, { skipGraphCleanup: true })
        : await window.electronAPI.recordings.deleteCascade(recording.id, true)

      if (!res?.success) {
        const graphUnavailable = !!(res as { graphUnavailable?: boolean } | undefined)?.graphUnavailable
        import('@/components/ui/toaster').then(({ toast }) => {
          if (graphUnavailable) {
            toast.error(FAILURE_NOTHING_DELETED_TITLE, graphCleanupFailedBody(recording.filename), {
              action: {
                label: LABEL_DELETE_ANYWAY_SKIP_GRAPH,
                onClick: () => {
                  void executeDeletePermanent(
                    recording,
                    { alsoDeleteFromDevice: opts?.alsoDeleteFromDevice ?? false, skipGraphCleanup: true },
                    impact
                  )
                }
              }
            })
          } else {
            toast.error(FAILURE_NOTHING_DELETED_TITLE, genericPermanentDeleteFailedBody(recording.filename))
          }
        })
        return
      }

      await refresh(false)

      // AR3-2 — the local purge succeeded; determine whether every on-disk
      // target was actually confirmed removed (the retry sweep may already
      // have cleared this purge's own first-attempt failures).
      const filesPending = res.allFilesRemoved === false
      const pendingKinds: string[] = res.pendingFileKinds ?? []

      // D3/AR3-6 — device branch, only after the local purge committed above.
      let deviceOutcome: 'not-requested' | 'success' | 'partial' = 'not-requested'
      // CX-T6-5/CX-T6-6 (fix rounds 2-3): the device copy was removed but the
      // VIEW may still show the pre-delete row — either because the
      // main-process reconciliation failed (CX-T6-5) or because the local
      // rebuild itself failed (CX-T6-6). Both replace the plain success
      // toast with the honest stale-view warning.
      let viewMayBeStale = false
      if (opts?.alsoDeleteFromDevice) {
        const targetDeviceFilename =
          impact?.deviceFilename ?? ('deviceFilename' in recording ? recording.deviceFilename : undefined)
        // AR3-6(a) TOCTOU — re-check live signals at EXECUTE time, not
        // confirm time: disconnected, or no longer a real device filename.
        if (!deviceConnected || !targetDeviceFilename) {
          deviceOutcome = 'partial'
        } else {
          try {
            const ok = await getHiDockDeviceService().deleteRecording(targetDeviceFilename)
            if (ok) {
              deviceOutcome = 'success'
              // AR3-6(b) — reconcile immediately so the UI doesn't show a
              // stale on-device row before the next authoritative scan.
              // CX-T6-1 (fix round): the hard cascade already deleted the
              // recordings row, so the id alone no longer resolves — pass the
              // device filename too, which reconciles the offline device
              // cache (the only remaining source that would resurrect this
              // file as a ghost device-only row).
              // CX-T6-5 (fix round 2): the IPC now propagates a real cache-
              // delete failure ({success:false}) instead of swallowing it —
              // treat that (or a thrown IPC) as stale-view and say so.
              try {
                const reconciled = await window.electronAPI.recordings.markNotOnDevice(
                  recording.id,
                  targetDeviceFilename
                )
                if (!reconciled?.success) {
                  viewMayBeStale = true
                  console.error(
                    '[Library] Device-presence reconciliation failed:',
                    (reconciled as { error?: string } | undefined)?.error
                  )
                }
              } catch (e) {
                viewMayBeStale = true
                console.error('[Library] Failed to reconcile device presence after delete:', e)
              }
              // CX-T6-4 (fix round 2): rebuild the unified view from the
              // ALREADY-RECONCILED local state — DB + device_file_cache +
              // the device service's (just-invalidated) in-memory list —
              // with NO device fetch. The previous refresh(true) here forced
              // a FULL device list scan (~90s on a loaded device), awaited
              // before the toast/`deleting` clear, so successful deletions
              // looked stuck and the un-cancelled scan kept running.
              // refreshLocal is also not subject to the hook's 2s load
              // debounce (which the post-cascade refresh(false) just armed).
              // Optional-chained only for older hook mocks in tests — the
              // real hook always provides it.
              // CX-T6-6 (fix round 3): refreshLocal reports failure
              // explicitly — false (or a throw) means the pre-delete row may
              // still be visible, so the honest stale-view warning applies,
              // never a plain success. `undefined` (an older partial hook
              // mock without the boolean contract) is no-signal, not failure.
              try {
                const rebuilt = await refreshLocal?.()
                if (rebuilt === false) {
                  viewMayBeStale = true
                  console.error('[Library] Post-device-delete local rebuild reported failure')
                }
              } catch (e) {
                viewMayBeStale = true
                console.error('[Library] Post-device-delete local rebuild failed:', e)
              }
            } else {
              deviceOutcome = 'partial'
            }
          } catch (e) {
            console.error('[Library] Device delete during permanent purge failed:', e)
            deviceOutcome = 'partial'
          }
        }
      }

      import('@/components/ui/toaster').then(({ toast }) => {
        // CX-T6-5/CX-T6-6: appended when the device copy WAS removed but the
        // view may still show it — reconciliation or the local rebuild failed.
        const staleNote = viewMayBeStale ? ` ${VIEW_MAY_BE_STALE_NOTE}` : ''
        if (deviceOutcome === 'partial' && filesPending) {
          // CX-T6-3 (fix round): BOTH partial outcomes must surface together —
          // the device-only body claims full local removal, which is untrue
          // while the pending-cleanup ledger is non-empty.
          toast.warning(COMBINED_PARTIAL_TITLE, combinedPartialBody(recording.filename, pendingKinds))
        } else if (deviceOutcome === 'partial') {
          toast.warning(DEVICE_COPY_REMAINS_TITLE, deviceCopyRemainsBody(recording.filename))
        } else if (filesPending) {
          toast.warning(FILES_PENDING_TITLE, filesPendingBody(recording.filename, pendingKinds) + staleNote)
        } else if (viewMayBeStale) {
          // Everything WAS deleted (local + device) — but the honest partial
          // path applies: warning variant, with the stale-view note.
          toast.warning(
            'Deleted permanently',
            `${actualRemovalSummary(res.removed, true)}${staleNote}`
          )
        } else {
          toast.success('Deleted permanently', actualRemovalSummary(res.removed, deviceOutcome === 'success'))
        }
      })
    } catch (e) {
      console.error('Failed to permanently delete:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error(FAILURE_NOTHING_DELETED_TITLE, genericPermanentDeleteFailedBody(recording.filename))
      })
    } finally {
      setDeleting(null)
    }
  }, [refresh, refreshLocal, deviceConnected])

  // spec-005/F17 T5 §D6 — fetches the impact and opens the dedicated
  // DeletePermanentDialog (replaces the shared confirmDialog for this flow;
  // ConfirmDialog has no slot for impact copy + the device checkbox).
  const handleDeletePermanent = useCallback(async (recording: UnifiedRecording) => {
    if (recording.location === 'device-only') return
    let impact: DeletePermanentDialogImpact | undefined
    try {
      const imp = await window.electronAPI.recordings.deletionImpact(recording.id)
      if (imp?.success && imp.data) {
        impact = {
          transcripts: imp.data.transcripts,
          actionItems: imp.data.actionItems,
          embeddings: imp.data.embeddings,
          captures: imp.data.captures,
          artifacts: imp.data.artifacts,
          hasAudioFile: imp.data.hasAudioFile,
          // spec-006/F17 T6 D5/AR3-8/F-INFO-6 — graph estimate (number = ~N,
          // null = UNKNOWN, never omitted) + on-device signal + the DB-sourced
          // device filename (a Trash row's UnifiedRecording never has one).
          graphEstimate: imp.data.graphEstimate,
          onDevice: imp.data.onDevice,
          deviceFilename: imp.data.deviceFilename
        }
      }
    } catch (e) {
      console.error('[Library] Failed to fetch deletion impact:', e)
      /* fall back to DeletePermanentDialog's own generic wording (impact undefined) */
    }
    setDeletePermanentDialog({ open: true, recording, impact })
  }, [])

  // Confirms the permanent-delete dialog: executes the purge, then closes the
  // dialog and (per §D1 step 7) refreshes the Trash count/list.
  const handleConfirmDeletePermanent = useCallback(async (opts: { alsoDeleteFromDevice: boolean }) => {
    const recording = deletePermanentDialog.recording
    const impact = deletePermanentDialog.impact
    setDeletePermanentDialog((prev) => ({ ...prev, open: false }))
    if (!recording) return
    await executeDeletePermanent(recording, opts, impact)
    // spec-005/F17 T5 §D1 step 7 — a purged row must leave the visible Trash
    // list too. Owned HERE (the T5 onConfirm wrapper), not inside
    // executeDeletePermanent — that function is T6's extension point
    // (alsoDeleteFromDevice), so Trash-list bookkeeping stays out of it.
    await loadTrash()
  }, [deletePermanentDialog.recording, deletePermanentDialog.impact, executeDeletePermanent, loadTrash])

  // spec-005/F17 T5 §D1 step 7 — undo a soft-delete from the Trash surface.
  // Refreshes BOTH the default pipeline (so the row reappears there) and the
  // Trash list (so it leaves Trash); the AR3-5 state-boundary effect above
  // handles clearing the row's own selection once trashedRecordings updates.
  const handleRestore = useCallback(async (recording: UnifiedRecording) => {
    try {
      const res = await window.electronAPI.recordings.restore(recording.id)
      if (!res?.success) throw new Error('Restore failed')
      await refresh(false)
      await loadTrash()
      announce(`Restored "${recording.filename}"`)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.success('Restored', `"${recording.filename}" is back in your Library.`)
      })
    } catch (e) {
      console.error('Failed to restore recording:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error('Restore Failed', `Failed to restore "${recording.filename}". Please try again.`)
      })
    }
  }, [refresh, loadTrash, announce])

  // Mark / unmark a recording "personal" (ignore) — reversible, non-destructive.
  const handleMarkPersonal = useCallback(async (recording: UnifiedRecording) => {
    const next = !recording.personal
    try {
      const res = await window.electronAPI.recordings.markPersonal(recording.id, next)
      if (!res?.success) throw new Error(res?.error || 'Failed')
      await refresh(false)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.success(
          next ? 'Marked personal' : 'Unmarked personal',
          next
            ? `"${recording.filename}" is kept but excluded from AI processing and default views.`
            : `"${recording.filename}" is back in AI processing and views.`
        )
      })
    } catch (e) {
      console.error('Failed to toggle personal:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error('Action Failed', `Could not update "${recording.filename}".`)
      })
    }
  }, [refresh])

  // Manual per-row value-rating override (F16/spec-003) — live update (no
  // re-index needed, mirrors handleMarkPersonal's refresh(false) pattern).
  const handleSetValueRating = useCallback(async (recording: UnifiedRecording, rating: QualityRating) => {
    try {
      const res = await window.electronAPI.recordings.setValueRating(recording.id, rating)
      if (!res?.success) throw new Error(res?.error || 'Failed')
      await refresh(false)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.success(
          rating === 'unrated' ? 'Rating cleared' : 'Rating updated',
          rating === 'unrated'
            ? `"${recording.filename}" rating was cleared.`
            : `"${recording.filename}" marked ${rating.replace('-', ' ')}.`
        )
      })
    } catch (e) {
      console.error('Failed to set value rating:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error('Action Failed', `Could not update the rating for "${recording.filename}".`)
      })
    }
  }, [refresh])

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

  const handleDeletePermanentCallback = useCallback(
    (recording: UnifiedRecording) => {
      handleDeletePermanent(recording)
    },
    [handleDeletePermanent]
  )

  // spec-005/F17 T5 §D3 — synced ("both") rows only; reuses the EXISTING device
  // path (handleDeleteFromDevice → executeDeleteFromDevice), no new Jensen code.
  const handleDeleteFromDeviceCallback = useCallback(
    (recording: UnifiedRecording) => {
      handleDeleteFromDevice(recording)
    },
    [handleDeleteFromDevice]
  )

  const handleRestoreCallback = useCallback(
    (recording: UnifiedRecording) => {
      handleRestore(recording)
    },
    [handleRestore]
  )

  const handleMarkPersonalCallback = useCallback(
    (recording: UnifiedRecording) => {
      handleMarkPersonal(recording)
    },
    [handleMarkPersonal]
  )

  const handleSetValueRatingCallback = useCallback(
    (recording: UnifiedRecording, rating: QualityRating) => {
      handleSetValueRating(recording, rating)
    },
    [handleSetValueRating]
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

  // Handle row click for tri-pane layout.
  // Clicking a row OPENS/VIEWS it — it sets the ACTIVE source only. It must NOT
  // enter bulk-selection mode. Bulk selection (the checkboxes) is a separate
  // action toggled by clicking a row's checkbox. Keeping "active/viewing source"
  // decoupled from "selected for bulk" is what stops a plain view-click from
  // revealing every row's checkbox (the "annoying selection checkbox" bug).
  const handleRowClick = useCallback((recording: UnifiedRecording) => {
    audioControls.stop()
    setSelectedSourceId(recording.id)

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

  // spec-005/F17 T5 §AR3-5 — Trash state boundaries. Re-evaluated whenever the
  // Trash corpus changes while showTrash is true, which covers BOTH halves of
  // the amendment with one effect:
  //   - "Entering Trash: stop playback if the playing row is trashed; clear
  //     selection/reader when the selected row isn't in the current corpus."
  //   - "Restore/purge in Trash clears that row's selection" — trashedRecordings
  //     shrinks after either (loadTrash() re-runs), which re-fires this same
  //     membership check.
  // A no-op while showTrash is false (leaving the live view's own state alone).
  useEffect(() => {
    if (!showTrash) return
    if (currentlyPlayingId && trashedRecordings.some((r) => r.id === currentlyPlayingId)) {
      audioControls.stop()
    }
    if (selectedSourceId && !trashedRecordings.some((r) => r.id === selectedSourceId)) {
      setSelectedSourceId(null)
    }
  }, [showTrash, trashedRecordings, currentlyPlayingId, selectedSourceId, audioControls, setSelectedSourceId])

  // Virtualization setup
  const parentRef = useRef<HTMLDivElement>(null)

  // B-LIB-008: Simplified estimateSize — complex calculations caused unnecessary
  // virtualizer re-measurements. The virtualizer uses measureElement for actual sizing.
  // Trash mode FORCES the SourceRow list regardless of viewMode (§D1 — SourceCard
  // has no onRestore affordance), so its row height (48) applies whenever showTrash.
  const estimateSize = useCallback(
    () => (compactView || showTrash) ? 48 : 200,
    [compactView, showTrash]
  )

  const rowVirtualizer = useVirtualizer({
    count: displayedRecordings.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5
  })

  // Reveal-on-open: when a source becomes the active/opened one (via row click,
  // deep-link navigation, search result, or programmatic open), scroll the
  // virtualized list so that row is in view. Without this, opening an old
  // recording (e.g. #1500 of 1911) leaves the user scrolling the whole list to
  // find what they just opened. We scroll once per newly-selected id (tracked in
  // a ref) so unrelated re-renders and filter changes don't yank the scroll, and
  // `align: 'auto'` only moves the list when the row isn't already visible.
  const lastScrolledSourceIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedSourceId) {
      lastScrolledSourceIdRef.current = null
      return
    }
    if (lastScrolledSourceIdRef.current === selectedSourceId) return
    const index = displayedRecordings.findIndex((r) => r.id === selectedSourceId)
    if (index < 0) return // not in the current (possibly filtered/Trash) list yet — retry when it appears
    lastScrolledSourceIdRef.current = selectedSourceId
    rowVirtualizer.scrollToIndex(index, { align: 'auto' })
  }, [selectedSourceId, displayedRecordings, rowVirtualizer])

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
        onImportFile={handleImportFile}
        onOpenFolder={openRecordingsFolder}
        onBulkDownload={handleBulkDownload}
        onBulkProcess={handleBulkProcess}
        onRefresh={() => refresh(true)}
        onSetCompactView={setCompactView}
        showTrash={showTrash}
        trashCount={trashedRecordings.length}
        onToggleTrash={handleToggleTrash}
      />

      {/* Device Disconnect Banner */}
      <DeviceDisconnectBanner
        show={showDisconnectBanner}
        isReconnecting={isReconnecting}
        onNavigateToDevice={() => navigate('/device')}
        onRetry={handleRetryConnection}
      />

      {/* Filters — hidden in Trash mode (spec-005/F17 T5 §D1: the location/value
          filter chips + search operate on the default pipeline and are meaningless
          for tombstones; a one-line banner sets Trash's own expectation instead). */}
      <div className="px-2 sm:px-4 lg:px-6 pb-3 border-b border-border relative">
        {showTrash ? (
          <div className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground" role="status">
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {TRASH_MODE_BANNER}
          </div>
        ) : (
          <div className={isFilterPending ? 'opacity-70 pointer-events-none transition-opacity' : 'transition-opacity'}>
            <LibraryFilters
              stats={stats}
              filterableCount={scopedRecordings.length}
              typeCounts={typeCounts}
              hasRatedQuality={ratedCount > 0}
              filterMode={filterMode}
              semanticFilter={semanticFilter}
              exclusiveFilter={exclusiveFilter}
              categoryFilter={categoryFilter ?? 'all'}
              qualityFilter={qualityFilter ?? 'all'}
              statusFilter={statusFilter ?? 'all'}
              sourceTypeFilter={sourceTypeFilter}
              durationPreset={durationPreset}
              searchQuery={searchQuery}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onFilterModeChange={setFilterMode}
              onSemanticFilterChange={setSemanticFilter}
              onExclusiveFilterChange={setExclusiveFilter}
              onCategoryFilterChange={(filter) => setCategoryFilter(filter === 'all' ? null : filter)}
              onQualityFilterChange={(filter) => setQualityFilter(filter === 'all' ? null : filter)}
              onStatusFilterChange={(filter) => setStatusFilter(filter === 'all' ? null : filter)}
              onSourceTypeFilterChange={setSourceTypeFilter}
              onDurationPresetChange={setDurationPreset}
              onSearchQueryChange={setSearchQuery}
              onSortByChange={setSortBy}
              onSortOrderChange={setSortOrder}
              onClearFilters={clearAllFilters}
            />
            {personalCount > 0 && (
              <div className="mt-2 flex items-center">
                <button
                  type="button"
                  onClick={() => setShowPersonal((v) => !v)}
                  aria-pressed={showPersonal}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    showPersonal
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                  }`}
                  title="Personal recordings are kept but excluded from AI processing and hidden by default"
                >
                  <EyeOff className="h-3 w-3" aria-hidden="true" />
                  {showPersonal ? `Showing ${personalCount} personal` : `Show ${personalCount} personal`}
                </button>
              </div>
            )}
          </div>
        )}
        {isFilterPending && !showTrash && (
          <div className="absolute top-2 right-2 pointer-events-none">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Bulk Actions Bar — hidden in Trash mode (CX-T5-1): its handlers all
          operate on filteredRecordings (the live list), so surfacing it over
          the Trash corpus would show misleading counts / no-op actions. The
          keyboard selection shortcuts are equally gated (guardedToggleSelection
          above), and handleToggleTrash clears any prior selection on entry. */}
      {!showTrash && (
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
          onMarkPersonal={handleSelectedMarkPersonal}
        />
      )}

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
              className="h-full overflow-y-auto overflow-x-hidden py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset"
              onKeyDown={handleKeyDown}
              tabIndex={0}
              role="application"
              aria-label="Recording list navigation. Use arrow keys to navigate, Space to select, Enter to open."
              data-testid="library-list"
            >
        {/* min-w-0 so the list content always shrinks to the pane width and NEVER
            scrolls horizontally — rows truncate instead. The pane itself has a
            sensible minimum (TriPaneLayout) so the title/date can't be starved. */}
        <div className={`w-full min-w-0 transition-opacity ${isFilterPending ? 'opacity-60' : 'opacity-100'}`}>
          {displayedRecordings.length === 0 ? (
            showTrash ? (
              // Trash-specific empty state — the quality-filter/EmptyState copy
              // below is about the default pipeline's filters and would be
              // nonsensical here (Trash isn't filtered, per §D1).
              <div className="text-center py-12 px-6 max-w-md mx-auto" role="status">
                <p className="text-base font-medium text-foreground">Trash is empty</p>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Recordings you move to Trash appear here until restored or deleted permanently.
                </p>
              </div>
            ) : qualityFilter !== null && qualityFilter !== 'unrated' && ratedCount === 0 ? (
              // Honest empty state: the quality filter isn't broken, there's just
              // no rated data yet. Say so, rather than a bare "no matches".
              <div className="text-center py-12 px-6 max-w-md mx-auto" role="status">
                <p className="text-base font-medium text-foreground">No captures are classified yet</p>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Nothing has a “{qualityFilter.replace('-', ' ')}” rating — every capture is still
                  “Unrated”. Ratings appear as captures are assessed.
                </p>
                <button
                  onClick={() => setQualityFilter(null)}
                  className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  Clear quality filter
                </button>
              </div>
            ) : (
              <EmptyState
                hasRecordings={recordings.length > 0}
                onNavigateToDevice={() => navigate('/device')}
                onAddRecording={handleAddRecording}
              />
            )
          ) : (
            <div className="animate-rise-in">
              {(compactView || showTrash) && (
                <div className="mb-2 flex items-center justify-between px-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {displayedRecordings.length} shown
                    </span>
                    {/* Select-all / deselect-all appears only once selection mode is
                        active (≥1 row selected), toggling every currently-shown row.
                        Never applicable in Trash — rows there never wire selection. */}
                    {!showTrash && selectedCount > 0 && (
                      <button
                        type="button"
                        onClick={toggleSelectAllShown}
                        aria-pressed={allShownSelected}
                        className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                      >
                        {allShownSelected ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                  </div>
                  {!showTrash && <StatusLegend />}
                </div>
              )}
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
              role="listbox"
              aria-label={showTrash ? 'Trash' : 'Knowledge Library'}
              aria-rowcount={displayedRecordings.length}
            >
              {/* spec-005/F17 T5 §D1 — Trash ALWAYS renders the SourceRow list, even
                  in card view: SourceCard has no onRestore affordance (AC#10). */}
              {(compactView || showTrash) ? (
                // Compact List View - LB-19 fix: Add focus indicator support
                <div key="compact-view">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = displayedRecordings[virtualRow.index]
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
                        {showTrash ? (
                          // Trash rows are menu-only (§D1): Library passes ONLY
                          // onRestore + onDeletePermanent — every other SourceRow
                          // menu item is onX &&-guarded and simply doesn't render.
                          <SourceRow
                            recording={recording}
                            meeting={meeting}
                            transcript={transcripts.get(recording.id)}
                            onRestore={() => handleRestoreCallback(recording)}
                            onDeletePermanent={() => handleDeletePermanentCallback(recording)}
                          />
                        ) : (
                          <SourceRow
                            recording={recording}
                            meeting={meeting}
                            transcript={transcripts.get(recording.id)}
                            isSelected={selectedIds.has(recording.id)}
                            anySelected={selectedCount > 0}
                            isActiveSource={selectedSourceId === recording.id}
                            searchQuery={deferredSearchQuery}
                            onSelectionChange={(id, shiftKey) =>
                              handleSelectionClick(id, shiftKey, filteredRecordings.map((r) => r.id))
                            }
                            onClick={() => handleRowClick(recording)}
                            onDownload={() => handleDownloadCallback(recording)}
                            onDelete={() => handleDeleteCallback(recording)}
                            onDeletePermanent={() => handleDeletePermanentCallback(recording)}
                            onDeleteFromDevice={
                              recording.location === 'both' ? () => handleDeleteFromDeviceCallback(recording) : undefined
                            }
                            onMarkPersonal={() => handleMarkPersonalCallback(recording)}
                            onSetValueRating={(rating) => handleSetValueRatingCallback(recording, rating)}
                            onTranscribe={() => queueTranscription(recording)}
                            onReprocessVibeVoice={() => reprocessWithVibeVoice(recording)}
                            onAskAssistant={() => handleAskAssistantCallback(recording)}
                            onGenerateOutput={() => handleGenerateOutputCallback(recording)}
                            isDownloading={isDeviceOnly(recording) && isDownloading(recording.deviceFilename)}
                            downloadProgress={
                              isDeviceOnly(recording) ? downloadQueue.get(recording.deviceFilename)?.progress : undefined
                            }
                            deviceConnected={deviceConnected}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                // Card View - LB-19 fix: Add focus indicator support
                <div key="card-view" className="space-y-4">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = displayedRecordings[virtualRow.index]
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
                          onMarkPersonal={() => handleMarkPersonalCallback(recording)}
                          onTranscribe={() => queueTranscription(recording)}
                          onReprocessVibeVoice={() => reprocessWithVibeVoice(recording)}
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
              onStop={handleStopCallback}
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
              onReprocessVibeVoice={() => {
                if (selectedRecording) reprocessWithVibeVoice(selectedRecording)
              }}
              onDelete={() => {
                if (selectedRecording) handleDeleteCallback(selectedRecording)
              }}
              onDeletePermanent={() => {
                if (selectedRecording) handleDeletePermanentCallback(selectedRecording)
              }}
              onDeleteFromDevice={() => {
                if (selectedRecording && selectedRecording.location === 'both') {
                  handleDeleteFromDeviceCallback(selectedRecording)
                }
              }}
              onMarkPersonal={() => {
                if (selectedRecording) handleMarkPersonalCallback(selectedRecording)
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
              // Metadata editing
              onMetadataEdited={() => refresh(false)}
              // Reveal the assistant: open the floating overlay, or expand the
              // embedded pane if it's collapsed to a rail (honors chat placement).
              onAskAboutSource={() => {
                const ui = useUIStore.getState()
                if (ui.chatPlacement === 'embedded') ui.setChatEmbeddedCollapsed(false)
                else ui.setChatOpen(true)
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

      {/* B-LIB-006: Confirm Dialog for destructive actions (soft delete, device
          delete, bulk delete). Permanent delete uses the dedicated dialog below. */}
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        actionLabel={confirmDialog.actionLabel}
        variant="destructive"
        onConfirm={confirmDialog.onConfirm}
      />

      {/* spec-005/F17 T5 §D6 — dedicated permanent-delete dialog (impact copy +
          device checkbox; ConfirmDialog has no slot for either). */}
      <DeletePermanentDialog
        open={deletePermanentDialog.open}
        onOpenChange={(open) => setDeletePermanentDialog((prev) => ({ ...prev, open }))}
        filename={deletePermanentDialog.recording?.filename ?? ''}
        impact={deletePermanentDialog.impact}
        // F-INFO-6: a Trash row's UnifiedRecording ALWAYS flattens to
        // 'local-only' (trashRowToUnified has no live device signal), so the
        // T5 live-signal gating (recording.location === 'both') would always
        // hide the checkbox there even when the underlying DB row genuinely
        // is on-device. In Trash mode, key off the impact's onDevice instead
        // (sourced straight from the DB row); live (non-trash) rows keep the
        // original live-signal gating.
        deviceConnected={
          !!deletePermanentDialog.recording &&
          deviceConnected &&
          (showTrash
            ? deletePermanentDialog.impact?.onDevice === true
            : deletePermanentDialog.recording.location === 'both')
        }
        onConfirm={handleConfirmDeletePermanent}
      />
    </div>
  )
}

export default Library
