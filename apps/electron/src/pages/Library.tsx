import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RefreshCw, AlertCircle, EyeOff, Trash2 } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { scanAndReconcile } from '@/services/device-sync-actions'
import { overlayActiveTranscriptionStatuses, useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import {
  UnifiedRecording,
  hasLocalPath,
  isDeviceOnly,
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
  MultiSelectionSummary,
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
import {
  BUILTIN_ARTIFACT_TYPES,
  getSourceType,
  matchesSourceTypeFilter,
  normalizeArtifactTypeDescriptors,
  type LibraryArtifactTypeDescriptor
} from '@/features/library/utils/sourceType'
import { matchesDurationPreset } from '@/features/library/utils/durationFilter'
import { trashRowToUnified } from '@/features/library/utils/trashRow'
import type { DatabaseRecording } from '@/hooks/useUnifiedRecordings'
import {
  softDeleteConfirmDescription,
  deviceDeleteConfirmDescription,
  LABEL_MOVE_TO_TRASH,
  LABEL_DELETE_FROM_DEVICE,
  TRASH_MODE_BANNER,
  LEGACY_GRAPH_DISCLOSURE,
  FAILURE_NOTHING_DELETED_TITLE,
  graphCleanupFailedBody,
  genericPermanentDeleteFailedBody,
  LABEL_DELETE_ANYWAY_SKIP_GRAPH,
  SUCCESS_MOVED_TO_TRASH_TITLE,
  SUCCESS_REMOVED_FROM_DEVICE_TITLE,
  SUCCESS_RESTORED_TITLE,
  PARTIAL_DELETE_TITLE,
  selectCompletionToast,
  type DeviceDeleteOutcome
} from '@/features/library/utils/deletionCopy'
import type { TypeCounts } from '@/features/library/components/LibraryFilters'
import { useLibraryStore, useLibrarySorting } from '@/store/useLibraryStore'
import { useOperations } from '@/hooks/useOperations'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'

const COMPACT_ROW_HEIGHT_PX = 48

type PermanentDeleteStage = 'removing-local' | 'erasing-device'

function purgeFilenameBase(filename?: string | null): string | null {
  if (!filename) return null
  return filename.trim().toLowerCase().replace(/\.(hda|wav|mp3)$/i, '')
}

export function Library() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    recordings: durableRecordings,
    loading,
    error,
    refresh,
    refreshLocal,
    deviceConnected,
  } = useUnifiedRecordings()

  // Hard-purged captures are knowledge tombstones, not fresh device sources.
  // Library owns this projection rule; Device/Sync deliberately keeps showing
  // a surviving hardware copy with its "Deleted" badge.
  const [purgedFilenameBases, setPurgedFilenameBases] = useState<Set<string>>(new Set())
  const [permanentDeleteProgress, setPermanentDeleteProgress] = useState<{
    recordingId: string
    filename: string
    stage: PermanentDeleteStage
  } | null>(null)

  // Subscribe only to semantic queue changes. Progress updates do not change
  // this primitive signature, so they cannot re-render/project ~2,000 rows.
  const activeTranscriptionSignature = useTranscriptionStore((state) => JSON.stringify(
    Array.from(state.queue.values())
      .filter((item) => item.status === 'pending' || item.status === 'processing')
      .map((item) => [item.recordingId, item.status] as const)
      .sort(([left], [right]) => left.localeCompare(right))
  ))
  const recordings = useMemo(() => {
    const pairs = JSON.parse(activeTranscriptionSignature) as Array<[string, 'pending' | 'processing']>
    const statuses = new Map<string, 'pending' | 'processing'>()
    for (const [recordingId, status] of pairs) {
      if (status === 'processing' || !statuses.has(recordingId)) statuses.set(recordingId, status)
    }
    return overlayActiveTranscriptionStatuses(durableRecordings, statuses).filter((recording) => {
      const deviceFilename = 'deviceFilename' in recording ? recording.deviceFilename : undefined
      const filenameBase = purgeFilenameBase(deviceFilename ?? recording.filename)
      return !filenameBase || !purgedFilenameBases.has(filenameBase)
    })
  }, [durableRecordings, activeTranscriptionSignature, purgedFilenameBases])

  const stats = useMemo(() => {
    let deviceOnly = 0
    let localOnly = 0
    let both = 0
    let synced = 0
    let unsynced = 0
    for (const recording of recordings) {
      if (recording.location === 'device-only') deviceOnly++
      else if (recording.location === 'local-only') localOnly++
      else both++
      if (recording.syncStatus === 'synced') synced++
      else unsynced++
    }
    return {
      total: recordings.length,
      deviceOnly,
      localOnly,
      both,
      synced,
      unsynced,
      onSource: deviceOnly + both,
      locallyAvailable: localOnly + both
    }
  }, [recordings])

  // Built-in and add-on artifact types come from the main-process registry.
  // A complete built-in fallback keeps the Library usable if IPC is unavailable.
  const [artifactTypes, setArtifactTypes] = useState<LibraryArtifactTypeDescriptor[]>(BUILTIN_ARTIFACT_TYPES)
  useEffect(() => {
    let cancelled = false
    const listTypes = window.electronAPI?.artifacts?.listTypes
    // During Electron HMR the renderer can update before preload/main restart.
    // Treat that version skew as a normal fallback, never a fatal page error.
    if (typeof listTypes !== 'function') return () => { cancelled = true }
    void listTypes().then((result) => {
      if (!cancelled && result.success) setArtifactTypes(normalizeArtifactTypeDescriptors(result.data))
    }).catch((registryError) => {
      console.warn('[Library] Artifact type registry unavailable; using built-ins:', registryError)
    })
    return () => { cancelled = true }
  }, [])

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
  const downloadCounts = useMemo(() => {
    let pending = 0
    let active = 0
    for (const entry of downloadQueue.values()) {
      if (entry.status === 'pending') pending++
      if (entry.status === 'downloading' || entry.status === 'cancelling') active++
    }
    return { pending, active }
  }, [downloadQueue])

  // UI state - expandedTranscripts centralized in useLibraryStore (B-LIB-005)
  const expandedTranscripts = useLibraryStore((state) => state.expandedTranscripts)
  const toggleTranscriptExpansion = useLibraryStore((state) => state.toggleTranscriptExpansion)

  // Filter state - persisted in store across navigation
  // Using useTransitionFilters for non-blocking filter updates
  const {
    exclusiveFilter,
    categoryFilter,
    qualityFilter,
    statusFilter,
    searchQuery,
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
  }, [exclusiveFilter, categoryFilter, qualityFilter, statusFilter, sourceTypeFilter, durationPreset, searchQuery])

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
    children?: React.ReactNode
  }>({ open: false, title: '', description: '', actionLabel: 'Delete', onConfirm: () => {} })

  // Bulk permanent-delete flow: the checkbox is rendered inside confirmDialog.children,
  // which is a stored React element. Keep its mutable value in a ref so the stored
  // confirm callback reads the user's latest choice instead of its opening snapshot.
  const bulkPurgeFromDeviceRef = useRef(true)

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

  const loadPurgedFilenameBases = useCallback(async () => {
    const getPurgedFilenames = window.electronAPI?.downloadService?.getPurgedFilenames
    if (!getPurgedFilenames) return
    try {
      const filenames = await getPurgedFilenames()
      setPurgedFilenameBases(new Set(filenames.map(purgeFilenameBase).filter((base): base is string => !!base)))
    } catch (e) {
      console.error('[Library] Failed to load purge tombstones:', e)
    }
  }, [])

  const suppressPurgedFilenames = useCallback((...filenames: Array<string | null | undefined>) => {
    setPurgedFilenameBases((previous) => {
      const next = new Set(previous)
      for (const filename of filenames) {
        const base = purgeFilenameBase(filename)
        if (base) next.add(base)
      }
      return next
    })
  }, [])

  useEffect(() => {
    void loadPurgedFilenameBases()
    const handleDownloadsCompleted = () => { void loadPurgedFilenameBases() }
    window.addEventListener('hidock:downloads-completed', handleDownloadsCompleted)
    return () => window.removeEventListener('hidock:downloads-completed', handleDownloadsCompleted)
  }, [loadPurgedFilenameBases])

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

      // ADV13: owner Library management — owner accessor shows the owner their OWN
      // excluded transcripts (gated getByRecordingIds is for assistant/discovery).
      const transcriptsObj = await window.electronAPI.transcripts.getByRecordingIdsOwner([recordingId])
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
      .filter((rec) => rec.meetingId)
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
        .filter((rec) => rec.meetingId)
        .map((rec) => rec.meetingId!)

      try {
        const [transcriptsObj, meetingsObj] = await Promise.all([
          recordingIdsForTranscripts.length > 0
            // ADV13: owner Library enrichment uses the owner accessor (see above).
            ? window.electronAPI.transcripts.getByRecordingIdsOwner(recordingIdsForTranscripts)
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

  // Stage 1: exact availability + personal visibility. Overlapping inclusive
  // accounting is deliberately not a user-facing Library query model.
  const baseRecordings = useMemo(() => {
    return recordings.filter((rec) => {
      const locationMatches = matchesExclusiveFilter(rec.location, exclusiveFilter)
      if (!locationMatches) return false
      if (rec.personal && !showPersonal) return false
      return true
    })
  }, [recordings, exclusiveFilter, showPersonal])

  // Type facet counts stay stable across availability changes so filtering to
  // device-only never makes Images/PDFs disappear and strand the user.
  const typeCounts = useMemo<TypeCounts>(() => {
    const typePopulation = recordings.filter((recording) => !recording.personal || showPersonal)
    const counts: TypeCounts = { all: typePopulation.length }
    for (const rec of typePopulation) {
      const type = getSourceType(rec, artifactTypes)
      counts[type] = (counts[type] ?? 0) + 1
    }
    return counts
  }, [recordings, showPersonal, artifactTypes])

  // Availability counts describe the selected artifact type, not the whole
  // library. Images/PDFs therefore never advertise impossible device states.
  const availabilityStats = useMemo(() => {
    const population = recordings.filter((recording) => {
      if (recording.personal && !showPersonal) return false
      return matchesSourceTypeFilter(getSourceType(recording, artifactTypes), sourceTypeFilter)
    })
    let deviceOnly = 0
    let localOnly = 0
    let both = 0
    for (const recording of population) {
      if (recording.location === 'device-only') deviceOnly++
      else if (recording.location === 'local-only') localOnly++
      else both++
    }
    return { total: population.length, deviceOnly, localOnly, both }
  }, [recordings, showPersonal, artifactTypes, sourceTypeFilter])

  // Whether any capture is actually rated — drives the honest Quality empty state.
  const ratedCount = useMemo(
    () => recordings.filter((r) => r.quality && r.quality !== 'unrated').length,
    [recordings]
  )

  // Stage 2: scoped set — apply source-type, duration, category, quality, status
  // (everything EXCEPT the list search). filterableCount = this length.
  const scopedRecordings = useMemo(() => {
    return baseRecordings.filter((rec) => {
      if (!matchesSourceTypeFilter(getSourceType(rec, artifactTypes), sourceTypeFilter)) return false
      if (!matchesDurationPreset(rec, durationPreset)) return false
      if (categoryFilter !== null && rec.category !== categoryFilter) return false
      if (qualityFilter !== null && rec.quality !== qualityFilter) return false
      if (statusFilter !== null && rec.status !== statusFilter) return false
      return true
    })
  }, [baseRecordings, artifactTypes, sourceTypeFilter, durationPreset, categoryFilter, qualityFilter, statusFilter])

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

  // `id` is the durable identity, but keep the renderer safe if an upstream
  // reconciliation regression momentarily projects two device rows with the
  // same database id. A filename-qualified key prevents React from retaining a
  // stale sibling DOM node on the same virtual track while the local rebuild
  // corrects the data.
  const itemRenderKeys = useMemo(() => {
    const idCounts = new Map<string, number>()
    for (const recording of displayedRecordings) {
      idCounts.set(recording.id, (idCounts.get(recording.id) ?? 0) + 1)
    }
    return displayedRecordings.map((recording) =>
      (idCounts.get(recording.id) ?? 0) > 1
        ? `${recording.id}::${recording.filename}`
        : recording.id
    )
  }, [displayedRecordings])

  // Summaries and bulk actions describe the complete selection in the active
  // corpus, even if a selected live recording is later hidden by a filter.
  const selectedRecordings = useMemo(
    () => (showTrash ? trashedRecordings : recordings).filter((recording) => selectedIds.has(recording.id)),
    [showTrash, trashedRecordings, recordings, selectedIds]
  )

  // Announce every result transition, including the return to an unfiltered
  // list. Leaving the prior filtered announcement mounted made assistive-tech
  // and copied page text claim "Showing 0" while thousands of rows were visible.
  useEffect(() => {
    if (loading) return
    announce(filteredRecordings.length === recordings.length
      ? `Showing all ${recordings.length} sources`
      : `Showing ${filteredRecordings.length} of ${recordings.length} sources`)
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

  // Selection works in Trash with the SAME explorer semantics as the live list
  // (2026-07-23 — the "you cannot select it in Trash" gap): plain click selects
  // + opens the detail, ctrl/shift build ranges, and the bulk bar offers the
  // Trash-appropriate actions (Restore / Delete permanently) over THIS corpus.
  const guardedToggleSelection = useCallback((id: string) => {
    toggleSelection(id)
  }, [toggleSelection])

  const guardedSelectAll = useCallback((ids: string[]) => {
    selectAll(ids)
  }, [selectAll])

  // Selection ∩ Trash corpus — drives the Trash bulk bar's visibility/count.
  // (Entering Trash clears the live selection, but belt-and-braces: a stale id
  // that isn't in the Trash corpus must never light the bar.)
  const trashSelectedCount = useMemo(
    () => trashedRecordings.filter((r) => selectedIds.has(r.id)).length,
    [trashedRecordings, selectedIds]
  )

  // Keyboard navigation for accessibility - LB-19 fix: Use focusedIndex and containerRef
  const { handleKeyDown, focusedIndex, containerRef } = useKeyboardNavigation({
    items: itemIds,
    selectedIds,
    expandedIds: new Set<string>(), // No expansion - keep for compatibility
    onToggleSelection: guardedToggleSelection,
    onSelectAll: guardedSelectAll,
    onClearSelection: useCallback(() => {
      clearSelection()
      setSelectedSourceId(null) // Esc also closes the reader panel (owner request)
    }, [clearSelection, setSelectedSourceId]),
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
      (r) => getSourceType(r, artifactTypes) === 'audio' && hasLocalPath(r) &&
        (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'no_speech' || r.transcriptionStatus === 'error')
    ).length
    return { deviceOnly, needsTranscription }
  }, [filteredRecordings, artifactTypes])

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
      (r) => getSourceType(r, artifactTypes) === 'audio' && hasLocalPath(r) &&
        (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'no_speech' || r.transcriptionStatus === 'error')
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
      (r) => selectedIds.has(r.id) && getSourceType(r, artifactTypes) === 'audio' && hasLocalPath(r) &&
        (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'no_speech' || r.transcriptionStatus === 'error')
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
  }, [filteredRecordings, selectedIds, artifactTypes, refresh, clearSelection, queueBulkTranscriptions])

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
          toast.warning(PARTIAL_DELETE_TITLE, `Deleted ${successCount} of ${selectedRecordings.length} items. ${errors.length} failed.`)
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

    // SOFT delete = Move to Trash: hidden + excluded from AI, RESTORABLE.
    // Nothing is erased from disk and device copies stay (device-only rows
    // are the exception — those are deleted from the hardware since the row
    // has no local existence at all).
    let description = `Move ${selectedRecordings.length} selected item${selectedRecordings.length > 1 ? 's' : ''} to Trash?`
    if (hasLocalFiles && hasDeviceFiles) {
      description += ' They will be hidden and restorable — except the device-only ones, which are erased from the device hardware.'
    } else {
      description += ' They will be hidden and excluded from AI, and you can restore them from Trash anytime. Nothing is erased from disk.'
    }

    setConfirmDialog({
      open: true,
      title: 'Move to Trash',
      description,
      actionLabel: 'Move to Trash',
      onConfirm: () => executeBulkDelete(selectedRecordings)
    })
  }, [filteredRecordings, selectedIds, executeBulkDelete])

  // (b) Bulk HARD purge — the same cascade the single-row "Delete permanently"
  // flow runs (tombstones + vector-cache invalidation + file unlink + retries),
  // with an optional "Also delete from device" pass over rows that have a
  // hardware copy. Honest aggregate outcome, never a blanket success claim.
  const handleSelectedDeletePermanent = useCallback(async () => {
    const selectedRecordings = displayedRecordings.filter((r) => selectedIds.has(r.id))
    if (selectedRecordings.length === 0) return

    // 2026-07-22 — device copies are detected AUTHORITATIVELY (per-row
    // deletionImpact, the same source the single-row dialog uses), NOT via the
    // unified `location` field: a row can be 'local-only' in the unified view
    // while on_device=1 in the DB (its device copy never showed in the bulk
    // dialog — the "missing checkbox" bug).
    const impacts = new Map<string, {
      onDevice?: boolean
      deviceFilename?: string | null
      transcripts?: number
      actionItems?: number
      embeddings?: number
      captures?: number
      artifacts?: number
      graphEstimate?: number | null
    }>()
    await Promise.all(
      selectedRecordings.map(async (recording) => {
        if (isDeviceOnly(recording)) {
          impacts.set(recording.id, { onDevice: true, deviceFilename: recording.deviceFilename })
          return
        }
        try {
          const impact = await window.electronAPI.recordings.deletionImpact(recording.id)
          if (impact?.success && impact.data) impacts.set(recording.id, impact.data)
        } catch {
          // The purge remains available, but the dialog omits unavailable estimates.
        }
      })
    )
    const deviceCopyCount = selectedRecordings.filter((recording) => impacts.get(recording.id)?.onDevice).length
    const allDeviceOnly = selectedRecordings.every(isDeviceOnly)
    const impactTotals = Array.from(impacts.values()).reduce<{
      transcripts: number
      actionItems: number
      embeddings: number
      captures: number
      artifacts: number
    }>(
      (totals, impact) => ({
        transcripts: totals.transcripts + (impact.transcripts ?? 0),
        actionItems: totals.actionItems + (impact.actionItems ?? 0),
        embeddings: totals.embeddings + (impact.embeddings ?? 0),
        captures: totals.captures + (impact.captures ?? 0),
        artifacts: totals.artifacts + (impact.artifacts ?? 0),
      }),
      { transcripts: 0, actionItems: 0, embeddings: 0, captures: 0, artifacts: 0 }
    )
    const impactSummary = [
      impactTotals.transcripts > 0 ? `${impactTotals.transcripts} transcript${impactTotals.transcripts === 1 ? '' : 's'}` : '',
      impactTotals.actionItems > 0 ? `${impactTotals.actionItems} action item${impactTotals.actionItems === 1 ? '' : 's'}` : '',
      impactTotals.embeddings > 0 ? `${impactTotals.embeddings} embedding${impactTotals.embeddings === 1 ? '' : 's'}` : '',
      impactTotals.captures > 0 ? `${impactTotals.captures} capture${impactTotals.captures === 1 ? '' : 's'}` : '',
      impactTotals.artifacts > 0 ? `${impactTotals.artifacts} artifact${impactTotals.artifacts === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(', ')

    const execute = async (alsoDeleteFromDevice: boolean) => {
      setBulkProcessing(true)
      setBulkProgress({ current: 0, total: selectedRecordings.length })
      let localPurged = 0
      let deviceOnlyDeleted = 0
      let deviceDeleted = 0
      let deviceQueued = 0
      let deviceRemains = 0
      let cleanupWarnings = 0
      let deviceCacheChanged = false
      const failures: string[] = []
      const deviceService = getHiDockDeviceService()
      try {
        for (let i = 0; i < selectedRecordings.length; i++) {
          const recording = selectedRecordings[i]
          const impact = impacts.get(recording.id)
          setBulkProgress({ current: i + 1, total: selectedRecordings.length })
          const initialStage: PermanentDeleteStage = isDeviceOnly(recording) ? 'erasing-device' : 'removing-local'
          setPermanentDeleteProgress({ recordingId: recording.id, filename: recording.filename, stage: initialStage })
          announce(
            initialStage === 'erasing-device'
              ? `Erasing device copy ${i + 1} of ${selectedRecordings.length}`
              : `Removing local data ${i + 1} of ${selectedRecordings.length}`
          )
          try {
            if (isDeviceOnly(recording)) {
              // Device-only rows have no local data to purge. Permanent deletion
              // therefore requires deleting their sole copy from the hardware.
              if (!alsoDeleteFromDevice) {
                failures.push(`${recording.filename}: device copy was kept`)
                continue
              }
              const ok = await deviceService.deleteRecording(recording.deviceFilename)
              if (!ok) {
                throw new Error(deviceService.getLastDeleteError?.() ?? 'The HiDock did not confirm the erase.')
              }
              suppressPurgedFilenames(recording.deviceFilename)
              const reconciled = await window.electronAPI.recordings.markNotOnDevice?.(
                recording.id,
                recording.deviceFilename
              )
              if (!reconciled?.success) cleanupWarnings++
              deviceOnlyDeleted++
              deviceDeleted++
              deviceCacheChanged = true
              continue
            }

            // Hard purge (v51 tombstones + binary-cache invalidation included).
            const res = await window.electronAPI.recordings.deleteCascade(recording.id, true)
            if (!res?.success) throw new Error(res?.error || 'Purge failed')
            suppressPurgedFilenames(
              recording.filename,
              impact?.deviceFilename,
              'deviceFilename' in recording ? recording.deviceFilename : undefined
            )
            if (selectedSourceId === recording.id) setSelectedSourceId(null)
            if (currentlyPlayingId === recording.id) audioControls.stop()
            localPurged++
            if (res.allFilesRemoved === false || res.graphCleanupSkipped) cleanupWarnings++

            if (alsoDeleteFromDevice && impact?.onDevice) {
              // Use the authoritative device-native filename from deletionImpact;
              // unified location can report local-only while a device copy exists.
              const targetDeviceFilename = impact.deviceFilename ?? (
                recording.location === 'both' ? recording.deviceFilename : undefined
              )
              if (!targetDeviceFilename) {
                deviceRemains++
                continue
              }
              try {
                setPermanentDeleteProgress({
                  recordingId: recording.id,
                  filename: targetDeviceFilename,
                  stage: 'erasing-device'
                })
                announce(`Removed from Library. Erasing device copy ${i + 1} of ${selectedRecordings.length}`)
                // Use the durable main-process path for connected and
                // disconnected states alike. It attempts exactly once now and,
                // on any USB failure, journals the device filename against this
                // hard-purge row for the next clean reconnect sweep.
                if (!res.journalId) {
                  deviceRemains++
                  continue
                }
                const queuedDelete = await window.electronAPI.recordings.queueDeviceDelete({
                  deviceFilename: targetDeviceFilename,
                  journalId: res.journalId,
                })
                if (!queuedDelete?.success) {
                  deviceRemains++
                } else if (queuedDelete.deletedNow) {
                  deviceDeleted++
                  deviceCacheChanged = true
                  deviceService.removeCachedRecording(targetDeviceFilename)
                  const markNotOnDevice = window.electronAPI.recordings.markNotOnDevice
                  if (markNotOnDevice) {
                    const reconciled = await markNotOnDevice(recording.id, targetDeviceFilename)
                    if (!reconciled?.success) cleanupWarnings++
                  } else {
                    cleanupWarnings++
                  }
                } else if (queuedDelete.queued) {
                  deviceQueued++
                } else {
                  deviceRemains++
                }
              } catch {
                deviceRemains++
              }
            }
          } catch (e) {
            failures.push(`${recording.filename}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        await refresh(false)
        if (deviceCacheChanged) await refreshLocal?.()
        await loadTrash()
        clearSelection()

        const removed = localPurged + deviceOnlyDeleted
        const issues = [
          failures.length > 0
            ? `${failures.length} failed: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`
            : '',
          cleanupWarnings > 0
            ? `${cleanupWarnings} item${cleanupWarnings === 1 ? '' : 's'} still has pending local cleanup`
            : '',
          deviceQueued > 0
            ? `${deviceQueued} device cop${deviceQueued === 1 ? 'y is' : 'ies are'} queued for erase on reconnect`
            : '',
          deviceRemains > 0
            ? `${deviceRemains} device cop${deviceRemains === 1 ? 'y remains' : 'ies remain'}`
            : '',
        ].filter(Boolean)
        const deviceNote = deviceDeleted > 0
          ? ` ${deviceDeleted} device cop${deviceDeleted === 1 ? 'y was' : 'ies were'} erased.`
          : ''

        if (issues.length > 0) {
          const oneFailedDeviceOnly =
            selectedRecordings.length === 1 &&
            isDeviceOnly(selectedRecordings[0]) &&
            removed === 0 &&
            failures.length === 1
          if (oneFailedDeviceOnly) {
            const failurePrefix = `${selectedRecordings[0].filename}: `
            const failureReason = failures[0].startsWith(failurePrefix)
              ? failures[0].slice(failurePrefix.length)
              : failures[0]
            toast.warning(
              'Device copy remains',
              `${failureReason} ${selectedRecordings[0].filename} is still on the device.`,
              { action: { label: 'Retry', onClick: () => { void execute(true) } } }
            )
          } else {
            toast.warning(
              'Permanent deletion completed with issues',
              `${removed} of ${selectedRecordings.length} item${selectedRecordings.length === 1 ? '' : 's'} permanently deleted. ${issues.join('; ')}.${deviceNote}`
            )
          }
        } else {
          toast.success(
            `Permanently deleted ${removed} item${removed === 1 ? '' : 's'}`,
            `All associated local data was erased.${deviceNote}`
          )
        }
      } finally {
        setBulkProcessing(false)
        setBulkProgress({ current: 0, total: 0 })
        setPermanentDeleteProgress(null)
      }
    }

    bulkPurgeFromDeviceRef.current = true
    setConfirmDialog({
      open: true,
      title: allDeviceOnly ? 'Erase from device' : 'Delete permanently',
      description: allDeviceOnly
        ? `Permanently erase ${selectedRecordings.length} selected recording${selectedRecordings.length === 1 ? '' : 's'} from the HiDock? ` +
          `No local cop${selectedRecordings.length === 1 ? 'y exists' : 'ies exist'}. This cannot be undone.`
        : `Permanently delete ${selectedRecordings.length} selected item${selectedRecordings.length > 1 ? 's' : ''}? ` +
          `This erases the recordings and all associated local data${impactSummary ? ` (${impactSummary})` : ''}. This cannot be undone.` +
          (deviceCopyCount > 0 ? ` ${deviceCopyCount} ${deviceCopyCount === 1 ? 'copy also exists' : 'copies also exist'} on the device.` : ''),
      actionLabel: allDeviceOnly ? 'Erase from device' : 'Delete permanently',
      children: deviceCopyCount > 0 && !allDeviceOnly ? (
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            defaultChecked
            onChange={(event) => { bulkPurgeFromDeviceRef.current = event.target.checked }}
            className="h-4 w-4 rounded border-border"
          />
          Also delete {deviceCopyCount === 1 ? 'the device copy' : `${deviceCopyCount} device copies`}
        </label>
      ) : undefined,
      onConfirm: () => execute(allDeviceOnly ? true : bulkPurgeFromDeviceRef.current)
    })
  }, [
    displayedRecordings,
    selectedIds,
    refresh,
    refreshLocal,
    loadTrash,
    clearSelection,
    suppressPurgedFilenames,
    announce,
    selectedSourceId,
    setSelectedSourceId,
    currentlyPlayingId,
    audioControls
  ])

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
    setPermanentDeleteProgress({ recordingId: recording.id, filename: recording.deviceFilename, stage: 'erasing-device' })
    announce(`Erasing the device copy for ${recording.filename}`)
    try {
      const deviceService = getHiDockDeviceService()
      const ok = await deviceService.deleteRecording(recording.deviceFilename)
      if (!ok) throw new Error(deviceService.getLastDeleteError?.() ?? 'The HiDock did not confirm the erase.')
      // `success` and idempotent `not-exists` both mean the hardware end state
      // is satisfied. Reconcile both caches immediately; waiting for the next
      // device scan leaves an already-absent file visible as device-only.
      const reconciled = await window.electronAPI.recordings.markNotOnDevice?.(
        recording.id,
        recording.deviceFilename
      )
      const rebuilt = await refreshLocal?.()
      const viewMayBeStale = !reconciled?.success || rebuilt === false
      // spec-005/F17 T5 §D2 — device delete previously only ever toasted on
      // error; a real removal now confirms success too.
      import('@/components/ui/toaster').then(({ toast }) => {
        if (viewMayBeStale) {
          toast.warning(
            'Device file is absent — view may be stale',
            `The HiDock no longer has "${recording.filename}", but the Library could not fully refresh. Use Refresh to reconcile the view.`
          )
        } else {
          toast.success(SUCCESS_REMOVED_FROM_DEVICE_TITLE, `"${recording.filename}" was erased from the HiDock.`)
        }
      })
    } catch (e) {
      console.error('Failed to delete from device:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        const reason = e instanceof Error ? e.message : String(e)
        toast.error('Device copy remains', `${reason} ${recording.filename} is still on the device.`)
      })
    } finally {
      setDeleting(null)
      setPermanentDeleteProgress(null)
    }
  }, [refreshLocal, announce])

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
        toast.success(SUCCESS_MOVED_TO_TRASH_TITLE, `"${recording.filename}" is hidden and excluded from processing.`, {
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
    setPermanentDeleteProgress({ recordingId: recording.id, filename: recording.filename, stage: 'removing-local' })
    announce(`Removing local data for ${recording.filename}`)
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

      suppressPurgedFilenames(
        recording.filename,
        impact?.deviceFilename,
        'deviceFilename' in recording ? recording.deviceFilename : undefined
      )
      if (selectedSourceId === recording.id) setSelectedSourceId(null)
      if (currentlyPlayingId === recording.id) audioControls.stop()

      await refresh(false)

      // AR3-2 — the local purge succeeded; determine whether every on-disk
      // target was actually confirmed removed (the retry sweep may already
      // have cleared this purge's own first-attempt failures).
      const filesPending = res.allFilesRemoved === false
      const pendingKinds: string[] = res.pendingFileKinds ?? []

      // D3/AR3-6 — device branch, only after the local purge committed above.
      let deviceOutcome: DeviceDeleteOutcome = 'not-requested'
      // CX-T6-5/CX-T6-6 (fix rounds 2-3): the device copy was removed but the
      // VIEW may still show the pre-delete row — either because the
      // main-process reconciliation failed (CX-T6-5) or because the local
      // rebuild itself failed (CX-T6-6). Both replace the plain success
      // toast with the honest stale-view warning.
      let viewMayBeStale = false
      if (opts?.alsoDeleteFromDevice) {
        const targetDeviceFilename =
          impact?.deviceFilename ?? ('deviceFilename' in recording ? recording.deviceFilename : undefined)
        if (!targetDeviceFilename) {
          deviceOutcome = 'partial'
        } else {
          setPermanentDeleteProgress({
            recordingId: recording.id,
            filename: targetDeviceFilename,
            stage: 'erasing-device'
          })
          announce(`Removed from Library. Erasing the device copy for ${recording.filename}`)
          // One main-process operation handles both connected and disconnected
          // states: attempt the hardware erase exactly once and durably journal
          // it on failure. The old connected branch bypassed the journal, so a
          // mid-command disconnect left the copy on the device forever.
          if (!res.journalId) {
            console.error('[Library] Cannot queue device delete: purge returned no journalId')
            deviceOutcome = 'partial'
          } else {
            try {
              const queuedDelete = await window.electronAPI.recordings.queueDeviceDelete({
                deviceFilename: targetDeviceFilename,
                journalId: res.journalId,
              })
              if (!queuedDelete?.success) {
                console.error('[Library] Failed to queue device delete:', queuedDelete?.error)
                deviceOutcome = 'partial'
              } else if (queuedDelete.deletedNow) {
                deviceOutcome = 'success'
                // The main-process Jensen path cannot mutate this renderer-owned
                // cache. Evict the exact filename before refreshLocal() or the
                // successful delete is reconstructed as a raw device-only row.
                getHiDockDeviceService().removeCachedRecording(targetDeviceFilename)
                // AR3-6(b) — reconcile immediately so the UI doesn't show a
                // stale on-device row before the next authoritative scan.
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
              } else if (queuedDelete.queued) {
                deviceOutcome = 'queued'
              } else {
                console.error('[Library] Device delete returned no terminal outcome')
                deviceOutcome = 'partial'
              }
            } catch (e) {
              console.error('[Library] Failed to queue device delete:', e)
              deviceOutcome = 'partial'
            }
          }
        }
      }

      import('@/components/ui/toaster').then(({ toast }) => {
        // The outcome ladder itself (priority: combined-partial >
        // device-partial > files-pending > stale-view > plain success) is a
        // pure function of these five inputs — see selectCompletionToast's
        // own doc comment for the full CX-T6-1..6 rationale.
        const { variant, title, body } = selectCompletionToast({
          filename: recording.filename,
          deviceOutcome,
          filesPending,
          pendingKinds,
          viewMayBeStale,
          // ARF-4 — the escape hatch deferred graph cleanup; force the honest
          // warning toast (never plain "Deleted permanently").
          graphCleanupDeferred: res.graphCleanupSkipped === true,
          // ADV49-1 (round 51) — failed file cleanup couldn't be journaled, so
          // it will NOT be auto-retried; forces the honest "remove manually" copy.
          cleanupUnrecoverable: res.cleanupUnrecoverable === true,
          removed: res.removed
        })
        toast[variant](title, body)
      })
    } catch (e) {
      console.error('Failed to permanently delete:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error(FAILURE_NOTHING_DELETED_TITLE, genericPermanentDeleteFailedBody(recording.filename))
      })
    } finally {
      setDeleting(null)
      setPermanentDeleteProgress(null)
    }
  }, [
    refresh,
    refreshLocal,
    suppressPurgedFilenames,
    announce,
    selectedSourceId,
    setSelectedSourceId,
    currentlyPlayingId,
    audioControls
  ])

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
        toast.success(SUCCESS_RESTORED_TITLE, `"${recording.filename}" is back in your Library.`)
      })
    } catch (e) {
      console.error('Failed to restore recording:', e)
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.error('Restore Failed', `Failed to restore "${recording.filename}". Please try again.`)
      })
    }
  }, [refresh, loadTrash, announce])

  // Bulk "Restore" (Trash): put every selected trashed recording back into the
  // live Library, then refresh both corpora.
  const handleSelectedRestore = useCallback(async () => {
    const targets = trashedRecordings.filter((r) => selectedIds.has(r.id))
    if (targets.length === 0) return
    setBulkProcessing(true)
    try {
      let restored = 0
      const failures: string[] = []
      for (const recording of targets) {
        try {
          const res = await window.electronAPI.recordings.restore(recording.id)
          if (!res?.success) throw new Error('Restore failed')
          restored++
        } catch (e) {
          failures.push(`${recording.filename}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      await refresh(false)
      await loadTrash()
      clearSelection()
      import('@/components/ui/toaster').then(({ toast }) => {
        if (failures.length === 0) {
          toast.success('Restored', `${restored} recording${restored === 1 ? '' : 's'} back in your Library.`)
        } else {
          toast.error('Some restores failed', `${restored} restored, ${failures.length} failed.`)
        }
      })
    } finally {
      setBulkProcessing(false)
    }
  }, [trashedRecordings, selectedIds, refresh, loadTrash, clearSelection])

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

  // Opening and bulk selection are separate modes. A plain click opens the
  // reader and clears bulk selection; modifiers deliberately build selection.
  const handleRowClick = useCallback((recording: UnifiedRecording) => {
    clearSelection()
    setSelectedSourceId(recording.id)
    audioControls.stop()

    const { waveformLoadedForId } = useUIStore.getState()
    if (getSourceType(recording, artifactTypes) === 'audio' && hasLocalPath(recording) && waveformLoadedForId !== recording.id) {
      audioControls.loadWaveformOnly(recording.id, recording.localPath)
    }
  }, [clearSelection, setSelectedSourceId, artifactTypes, audioControls])

  // C-005: Keep openDetailRef in sync with handleRowClick + displayedRecordings
  openDetailRef.current = (id: string) => {
    const recording = displayedRecordings.find((r) => r.id === id)
    if (recording) {
      handleRowClick(recording)
    }
  }

  // Get selected recording and its data for SourceReader — looked up in the
  // VISIBLE corpus: a Trash row is not in the live list, so reading from
  // `recordings` here is what left the panel stuck on "No recording selected".
  // A deep link from Operations must open the source even when the user's current
  // Library filters exclude it. Keep those filters intact (so Back preserves the
  // exact working context), but resolve the reader from the full live corpus.
  const selectedRecording = selectedSourceId
    ? (showTrash
        ? displayedRecordings.find((r) => r.id === selectedSourceId)
        : recordings.find((r) => r.id === selectedSourceId)) ?? null
    : null
  const selectionOutsideCurrentView = Boolean(
    selectedRecording && !displayedRecordings.some((recording) => recording.id === selectedRecording.id)
  )
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
  // A ref alone does not notify TanStack Virtual when the list pane is
  // collapsed and later remounted. Keep the current scroll element in state so
  // the virtualizer observes the replacement node instead of rendering an
  // empty measured range after the source rail is reopened.
  const [listScrollElement, setListScrollElement] = useState<HTMLDivElement | null>(null)

  // B-LIB-008: Simplified estimateSize — complex calculations caused unnecessary
  // virtualizer re-measurements. The virtualizer uses measureElement for actual sizing.
  // Trash mode FORCES the SourceRow list regardless of viewMode (§D1 — SourceCard
  // has no onRestore affordance), so its row height (48) applies whenever showTrash.
  const estimateSize = useCallback(
    () => (compactView || showTrash) ? COMPACT_ROW_HEIGHT_PX : 200,
    [compactView, showTrash]
  )

  // Identity, not the current array index, owns every cached measurement. A
  // split replaces one source with two children at the same position; index
  // keys otherwise attach the old row's geometry to the wrong recordings.
  const getVirtualItemKey = useCallback(
    (index: number) => itemRenderKeys[index] ?? index,
    [itemRenderKeys]
  )

  const rowVirtualizer = useVirtualizer({
    count: displayedRecordings.length,
    getScrollElement: () => listScrollElement,
    estimateSize,
    getItemKey: getVirtualItemKey,
    overscan: 5
  })

  // After a deletion/insert every row shifts one index, and the virtualizer's
  // index-keyed measurement cache pairs each row with the PREVIOUS occupant's
  // measured height — taller (two-line-title) rows then overlap their neighbor
  // and separators "go missing" (2026-07-20). Force a full re-measure whenever
  // the list CONTENT changes. This runs before paint so replacing the split
  // source cannot expose one frame of stale/overlapping offsets.
  const displayedIdSignature = itemRenderKeys.join('|')
  useLayoutEffect(() => {
    rowVirtualizer.measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedIdSignature, compactView, showTrash])

  // Scroll-anchor preservation (2026-07-21/22): a deletion above the viewport
  // shifts every row up but scrollTop doesn't move — the list then renders a
  // half-clipped row at the top ("un-alignment when I delete"). ESTIMATED
  // heights can't fix this (rows are variable-height), so anchor to an ITEM:
  // track the topmost visible row's id continuously, and after any list change
  // scroll THAT item back to the top of the viewport. Refresh/surface-change
  // "fixed" it the same way implicitly — this makes it automatic.
  const prevItemIdsRef = useRef<string[]>([])
  const firstVisibleIndexRef = useRef(0)

  // Keep the topmost VISIBLE row's index current. getVirtualItems() includes
  // overscan rows above the viewport, so items[0] is not a valid scroll anchor.
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const onScroll = () => {
      const firstVisible = rowVirtualizer.getVirtualItems().find(
        (item) => item.start + item.size > el.scrollTop
      )
      if (firstVisible) firstVisibleIndexRef.current = firstVisible.index
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [rowVirtualizer])

  useEffect(() => {
    const prevIds = prevItemIdsRef.current
    const el = parentRef.current
    if (prevIds.length > 0 && itemIds.length > 0) {
      const removed = prevIds.some((id) => !itemIds.includes(id))
      if (removed) {
        const anchorId = prevIds[firstVisibleIndexRef.current]
        const newIndex = anchorId ? itemIds.indexOf(anchorId) : -1
        if (newIndex >= 0) {
          rowVirtualizer.scrollToIndex(newIndex, { align: 'start' })
        } else {
          // The anchor row itself was deleted — land on the nearest surviving row.
          rowVirtualizer.scrollToIndex(Math.min(firstVisibleIndexRef.current, itemIds.length - 1), {
            align: 'start',
          })
        }
      }
      // Clamp past-the-end scrolls (list shrank below the scroll position).
      if (el) {
        const max = Math.max(0, rowVirtualizer.getTotalSize() - el.clientHeight)
        if (el.scrollTop > max) rowVirtualizer.scrollToOffset(max)
      }
    }
    prevItemIdsRef.current = itemIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedIdSignature])

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
        deviceOnlyActive={!showTrash && sourceTypeFilter === 'audio' && exclusiveFilter === 'source-only'}
        loading={loading}
        compactView={compactView}
        pendingDownloadCount={downloadCounts.pending}
        activeDownloadCount={downloadCounts.active}
        bulkCounts={bulkCounts}
        bulkProcessing={bulkProcessing}
        bulkProgress={bulkProgress}
        onAddRecording={handleAddRecording}
        onImportFile={handleImportFile}
        onOpenFolder={openRecordingsFolder}
        onBulkDownload={handleBulkDownload}
        onBulkProcess={handleBulkProcess}
        onShowDeviceOnly={() => {
          clearSelection()
          setSelectedSourceId(null)
          setDurationPreset('all')
          setCategoryFilter(null)
          setExclusiveFilter('source-only')
          setSourceTypeFilter('audio')
          announce(`Showing ${stats.deviceOnly} audio capture${stats.deviceOnly === 1 ? '' : 's'} on device only`)
        }}
        onRefresh={() => {
          // Manual force-sync (2026-07-22): probe the device count, rescan when
          // the list moved, reconcile + download new files (an explicit user
          // request — not subject to the auto-download toggle), THEN rebuild the
          // view. When the device is disconnected scanAndReconcile no-ops and
          // this degrades to the old local refresh.
          void (async () => {
            await scanAndReconcile('manual')
            await refresh(true)
          })()
        }}
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
          <div className="py-1.5" role="status">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              {TRASH_MODE_BANNER}
            </div>
            {/* RE-3 — honest disclosure: trashing excludes THIS-version content
                from AI + views, but legacy (earlier-version) graph facts can't
                be retracted per recording and persist until a full rebuild. */}
            <p className="mt-0.5 pl-6 text-xs text-muted-foreground/80">{LEGACY_GRAPH_DISCLOSURE}</p>
          </div>
        ) : (
          <div className={isFilterPending ? 'opacity-70 pointer-events-none transition-opacity' : 'transition-opacity'}>
            <LibraryFilters
              stats={availabilityStats}
              filterableCount={scopedRecordings.length}
              typeCounts={typeCounts}
              artifactTypes={artifactTypes}
              hasRatedQuality={ratedCount > 0}
              exclusiveFilter={exclusiveFilter}
              categoryFilter={categoryFilter ?? 'all'}
              qualityFilter={qualityFilter ?? 'all'}
              statusFilter={statusFilter ?? 'all'}
              sourceTypeFilter={sourceTypeFilter}
              durationPreset={durationPreset}
              searchQuery={searchQuery}
              sortBy={sortBy}
              sortOrder={sortOrder}
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

      {/* Bulk Actions Bar — live list: full action set. Trash (2026-07-23): a
          dedicated bar with ONLY the Trash-appropriate actions over the Trash
          selection (Restore / Delete permanently) — the live-list actions would
          be no-ops here. */}
      {!showTrash ? (
        <BulkActionsBar
          selectedCount={selectedCount}
          totalCount={filteredRecordings.length}
          deviceConnected={deviceConnected}
          isProcessing={bulkProcessing}
          progress={bulkProgress.total > 0 ? bulkProgress : undefined}
          showDownload={selectedRecordings.some((recording) => isDeviceOnly(recording))}
          showProcess={selectedRecordings.some(
            (recording) => getSourceType(recording, artifactTypes) === 'audio' && hasLocalPath(recording)
          )}
          onSelectAll={() => selectAll(filteredRecordings.map((r) => r.id))}
          onDeselectAll={clearSelection}
          onDownload={handleSelectedDownload}
          onProcess={handleSelectedProcess}
          onDelete={handleSelectedDelete}
          onDeletePermanent={handleSelectedDeletePermanent}
          onMarkPersonal={handleSelectedMarkPersonal}
        />
      ) : trashSelectedCount > 0 && (
        <div
          className="flex items-center gap-3 border-b bg-muted/40 px-6 py-2"
          data-testid="trash-bulk-bar"
          role="toolbar"
          aria-label="Trash bulk actions"
        >
          <span className="text-sm font-medium">
            {trashSelectedCount} of {trashedRecordings.length} selected
          </span>
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => selectAll(trashedRecordings.map((r) => r.id))}
          >
            Select all
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={bulkProcessing}
              onClick={handleSelectedRestore}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Restore
            </button>
            <button
              type="button"
              disabled={bulkProcessing}
              onClick={handleSelectedDeletePermanent}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Delete permanently
            </button>
            <button
              type="button"
              aria-label="Clear selection"
              onClick={clearSelection}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              ✕
            </button>
          </div>
        </div>
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
          hasSelection={selectedSourceId !== null || selectedRecordings.length > 0}
          leftPanel={
            /* Left Panel: Recording List - LB-19 fix: Add containerRef for keyboard navigation */
            <div
              ref={(el) => {
                // @ts-expect-error - Ref callback pattern for multiple refs
                parentRef.current = el
                // @ts-expect-error - Ref callback pattern for multiple refs
                containerRef.current = el
                setListScrollElement((current) => current === el ? current : el)
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
          {permanentDeleteProgress && (
            <div
              className="mx-3 mb-2 flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs"
              data-testid="permanent-delete-progress"
              role="status"
              aria-live="polite"
            >
              <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {permanentDeleteProgress.stage === 'removing-local'
                    ? 'Removing local data…'
                    : bulkProgress.total > 1
                      ? `Erasing device copies… ${bulkProgress.current} of ${bulkProgress.total}`
                      : 'Erasing device copy…'}
                </p>
                <p className="truncate text-muted-foreground" title={permanentDeleteProgress.filename}>
                  {permanentDeleteProgress.filename}
                </p>
              </div>
            </div>
          )}
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
                selectedOutsideFilters={selectionOutsideCurrentView}
                onRevealSelected={() => {
                  clearAllFilters()
                  setSearchQuery('')
                }}
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
                // Include the content identity in the boundary key so a split
                // replaces the virtual-row subtree atomically. This also clears
                // any stale DOM left by a previously duplicated React key.
                <div key={`compact-view:${displayedIdSignature}`}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = displayedRecordings[virtualRow.index]
                    const meeting = recording.meetingId ? meetings.get(recording.meetingId) : undefined
                    const isFocused = focusedIndex === virtualRow.index

                    return (
                      <div
                        key={itemRenderKeys[virtualRow.index]}
                        data-index={virtualRow.index}
                        data-focus-index={virtualRow.index}
                        // Compact rows are a strict 48px contract. Measuring
                        // them dynamically reintroduces stale index geometry
                        // during split insertion; the estimate is exact.
                        style={{
                          position: 'absolute',
                          // Use layout positioning, not a transformed compositor
                          // layer. Chromium can retain stale glyph pixels on a
                          // recycled transformed row after split insertion,
                          // producing the doubled metadata text seen in the app.
                          top: `${virtualRow.index * COMPACT_ROW_HEIGHT_PX}px`,
                          left: 0,
                          width: '100%',
                          height: `${COMPACT_ROW_HEIGHT_PX}px`
                        }}
                        className={[
                          // Keep separators out of measured row geometry. A real
                          // border changes the height whenever selection joins or
                          // splits a run, leaving cached virtual offsets one pixel
                          // out of alignment until the next full refresh.
                          virtualRow.index > 0 &&
                          !(selectedIds.has(recording.id) &&
                            selectedIds.has(displayedRecordings[virtualRow.index - 1]?.id))
                            ? 'before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border'
                            : '',
                          isFocused ? 'ring-2 ring-primary ring-inset' : ''
                        ].join(' ')}
                        aria-rowindex={virtualRow.index + 1}
                      >
                        {showTrash ? (
                          // Trash rows: SAME selection semantics as the live list
                          // (plain click selects + opens detail; ctrl/shift build
                          // ranges) plus the Trash-only menu actions (§D1):
                          // Restore + Delete permanently.
                          <SourceRow
                            recording={recording}
                            meeting={meeting}
                            transcript={transcripts.get(recording.id)}
                            compact
                            isSelected={selectedIds.has(recording.id)}
                            anySelected={selectedCount > 0}
                            isActiveSource={selectedSourceId === recording.id}
                            isDeleting={deleting === recording.id || permanentDeleteProgress?.recordingId === recording.id}
                            deletionLabel={
                              permanentDeleteProgress?.recordingId === recording.id &&
                              permanentDeleteProgress.stage === 'erasing-device'
                                ? 'Erasing device copy…'
                                : 'Removing local data…'
                            }
                            onSelectionChange={(id, shiftKey) =>
                              handleSelectionClick(id, shiftKey, displayedRecordings.map((r) => r.id))
                            }
                            onClick={() => handleRowClick(recording)}
                            onRestore={() => handleRestoreCallback(recording)}
                            onDeletePermanent={() => handleDeletePermanentCallback(recording)}
                          />
                        ) : (
                          <SourceRow
                            recording={recording}
                            meeting={meeting}
                            transcript={transcripts.get(recording.id)}
                            compact
                            isSelected={selectedIds.has(recording.id)}
                            anySelected={selectedCount > 0}
                            isActiveSource={selectedSourceId === recording.id}
                            isDeleting={deleting === recording.id || permanentDeleteProgress?.recordingId === recording.id}
                            deletionLabel={
                              permanentDeleteProgress?.recordingId === recording.id &&
                              permanentDeleteProgress.stage === 'erasing-device'
                                ? 'Erasing device copy…'
                                : 'Removing local data…'
                            }
                            searchQuery={deferredSearchQuery}
                            onSelectionChange={(id, shiftKey) =>
                              handleSelectionClick(id, shiftKey, displayedRecordings.map((r) => r.id))
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
                            onTranscribe={getSourceType(recording, artifactTypes) === 'audio' ? () => queueTranscription(recording) : undefined}
                            onReprocessVibeVoice={getSourceType(recording, artifactTypes) === 'audio' ? () => reprocessWithVibeVoice(recording) : undefined}
                            onAskAssistant={() => handleAskAssistantCallback(recording)}
                            onGenerateOutput={() => handleGenerateOutputCallback(recording)}
                            isDownloading={isDeviceOnly(recording) && ['downloading', 'cancelling'].includes(
                              downloadQueue.get(recording.deviceFilename)?.status ?? ''
                            )}
                            downloadProgress={
                              isDeviceOnly(recording) ? downloadQueue.get(recording.deviceFilename)?.progress : undefined
                            }
                            downloadStatus={
                              isDeviceOnly(recording) ? downloadQueue.get(recording.deviceFilename)?.status : undefined
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
                        key={itemRenderKeys[virtualRow.index]}
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
                          isDownloading={isDeviceOnly(recording) && ['downloading', 'cancelling'].includes(
                            downloadQueue.get(recording.deviceFilename)?.status ?? ''
                          )}
                          downloadProgress={
                            isDeviceOnly(recording) ? downloadQueue.get(recording.deviceFilename)?.progress : undefined
                          }
                          downloadStatus={
                            isDeviceOnly(recording) ? downloadQueue.get(recording.deviceFilename)?.status : undefined
                          }
                          isDeleting={deleting === recording.id}
                          deviceConnected={deviceConnected}
                          isSelected={selectedIds.has(recording.id)}
                          onSelectionChange={(id, shiftKey) =>
                            handleSelectionClick(id, shiftKey, displayedRecordings.map((r) => r.id))
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
                          onTranscribe={getSourceType(recording, artifactTypes) === 'audio' ? () => queueTranscription(recording) : undefined}
                          onReprocessVibeVoice={getSourceType(recording, artifactTypes) === 'audio' ? () => reprocessWithVibeVoice(recording) : undefined}
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
            /* Center Panel: multi-selection summary (explorer behavior) or the
               single-recording Source Reader. */
            selectedRecordings.length > 1 ? (
              <MultiSelectionSummary
                recordings={selectedRecordings}
                mode={showTrash ? 'trash' : 'library'}
              />
            ) : (
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
              onDownload={selectedRecording && isDeviceOnly(selectedRecording)
                ? () => handleDownloadCallback(selectedRecording)
                : undefined}
              onTranscribe={selectedRecording && getSourceType(selectedRecording, artifactTypes) === 'audio'
                ? () => queueTranscription(selectedRecording)
                : undefined}
              onReprocessVibeVoice={selectedRecording && getSourceType(selectedRecording, artifactTypes) === 'audio'
                ? () => reprocessWithVibeVoice(selectedRecording)
                : undefined}
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
                ? ['downloading', 'cancelling'].includes(downloadQueue.get(selectedRecording.deviceFilename)?.status ?? '')
                : false}
              downloadProgress={selectedRecording && isDeviceOnly(selectedRecording)
                ? downloadQueue.get(selectedRecording.deviceFilename)?.progress
                : undefined}
              downloadStatus={selectedRecording && isDeviceOnly(selectedRecording)
                ? downloadQueue.get(selectedRecording.deviceFilename)?.status
                : undefined}
              isDeleting={selectedRecording ? deleting === selectedRecording.id : false}
              // Navigation
              onNavigateToMeeting={handleNavigateToMeeting}
              // Metadata editing
              onMetadataEdited={() => refresh(false)}
              onSplitCompleted={(firstChildId) => {
                audioControls.stop()
                // The split transaction already updated local DB state. Rebuild
                // from local/cache data immediately: refresh(false) can debounce,
                // while a forced refresh could start an unnecessary USB scan.
                void refreshLocal?.().then((rebuilt) => {
                  if (rebuilt !== false) setSelectedSourceId(firstChildId)
                })
              }}
              // Reveal the assistant: open the floating overlay, or expand the
              // embedded pane if it's collapsed to a rail (honors chat placement).
              onAskAboutSource={() => {
                const ui = useUIStore.getState()
                if (ui.chatPlacement === 'embedded') ui.setChatEmbeddedCollapsed(false)
                else ui.setChatOpen(true)
              }}
            />
            )
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
      >
        {confirmDialog.children}
      </ConfirmDialog>

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
