import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Mic,
  FileText,
  Calendar,
  Play,
  X,
  RefreshCw,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  Cloud,
  Check,
  Download,
  HardDrive,
  Filter,
  Search,
  Plus,
  AlertCircle,
  Zap,
  LayoutGrid,
  List,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AudioPlayer } from '@/components/AudioPlayer'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { parseJsonArray } from '@/types'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import {
  UnifiedRecording,
  LocationFilter,
  hasLocalPath,
  isDeviceOnly
} from '@/types/unified-recording'
import { useAudioControls } from '@/components/OperationController'
import { useUIStore } from '@/store/useUIStore'
import { useAppStore } from '@/store/useAppStore'

interface Transcript {
  id: string
  recording_id: string
  full_text: string
  language: string
  summary?: string
  action_items?: string
  topics?: string
  key_points?: string
  sentiment?: string
  speakers?: string
  word_count?: number
  transcription_provider?: string
  transcription_model?: string
  created_at: string
}

interface Meeting {
  id: string
  subject: string
  start_time: string
}

export function Recordings() {
  const navigate = useNavigate()
  const { recordings, loading, error, refresh, deviceConnected, stats } = useUnifiedRecordings()

  // Centralized audio controls (persists across navigation)
  const audioControls = useAudioControls()
  const currentlyPlayingId = useUIStore((state) => state.currentlyPlayingId)

  // Get download queue from app store to check download status
  const { downloadQueue, isDownloading } = useAppStore()

  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set())
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  // View mode persisted in store across navigation
  const compactView = useUIStore((state) => state.recordingsCompactView)
  const setCompactView = useUIStore((state) => state.setRecordingsCompactView)
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 })
  const [deleting, setDeleting] = useState<string | null>(null)

  // Enrichment: Load transcripts and meetings for recordings
  const [transcripts, setTranscripts] = useState<Map<string, Transcript>>(new Map())
  const [meetings, setMeetings] = useState<Map<string, Meeting>>(new Map())

  // Memoize recording IDs that need enrichment to avoid unnecessary re-fetches
  // Only triggers when the set of local recordings changes, not on every property update
  const enrichmentKey = useMemo(() => {
    const localRecordingIds = recordings
      .filter(rec => hasLocalPath(rec))
      .map(rec => rec.id)
      .sort()
      .join(',')
    const meetingIds = recordings
      .filter(rec => hasLocalPath(rec) && rec.meetingId)
      .map(rec => rec.meetingId!)
      .sort()
      .join(',')
    return `${localRecordingIds}|${meetingIds}`
  }, [recordings])

  // Load enrichment data only when the set of IDs that need data changes
  useEffect(() => {
    const loadEnrichment = async () => {
      // Collect all recording IDs that need transcript lookups (local recordings only)
      const recordingIdsForTranscripts = recordings
        .filter(rec => hasLocalPath(rec))
        .map(rec => rec.id)

      // Collect all meeting IDs that need to be fetched
      const meetingIds = recordings
        .filter(rec => hasLocalPath(rec) && rec.meetingId)
        .map(rec => rec.meetingId!)

      try {
        // Batch fetch transcripts and meetings in parallel (2 queries instead of N)
        const [transcriptsObj, meetingsObj] = await Promise.all([
          recordingIdsForTranscripts.length > 0
            ? window.electronAPI.transcripts.getByRecordingIds(recordingIdsForTranscripts)
            : Promise.resolve({}),
          meetingIds.length > 0
            ? window.electronAPI.meetings.getByIds(meetingIds)
            : Promise.resolve({})
        ])

        // Convert plain objects to Maps
        const newTranscripts = new Map<string, Transcript>(
          Object.entries(transcriptsObj) as [string, Transcript][]
        )
        const newMeetings = new Map<string, Meeting>(
          Object.entries(meetingsObj) as [string, Meeting][]
        )

        setTranscripts(newTranscripts)
        setMeetings(newMeetings)
      } catch (e) {
        console.error('[Recordings] Failed to load enrichment data:', e)
      }
    }

    if (recordings.length > 0) {
      loadEnrichment()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichmentKey]) // Only re-run when the set of IDs needing enrichment changes

  // Filter recordings based on location and search
  const filteredRecordings = useMemo(() => {
    return recordings.filter((rec) => {
      // Location filter
      if (locationFilter !== 'all' && rec.location !== locationFilter) {
        return false
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const filename = rec.filename.toLowerCase()
        const meetingSubject = rec.meetingSubject?.toLowerCase() || ''
        return filename.includes(query) || meetingSubject.includes(query)
      }

      return true
    })
  }, [recordings, locationFilter, searchQuery])

  const toggleTranscript = (id: string) => {
    setExpandedTranscripts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const openRecordingsFolder = async () => {
    await window.electronAPI.storage.openFolder('recordings')
  }

  // Queue single download via centralized service (handled by OperationController)
  const handleDownload = async (recording: UnifiedRecording) => {
    if (!isDeviceOnly(recording)) return
    if (!deviceConnected) return

    try {
      // Queue via download service - OperationController handles the actual download
      // IMPORTANT: Pass dateCreated to preserve original recording date from device
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
  }

  const handleAddRecording = async () => {
    try {
      const result = await window.electronAPI.recordings.addExternal()
      if (result.success) {
        // Refresh the recordings list
        await refresh(false)
      } else if (result.error && result.error !== 'No file selected') {
        // Only show error if it's not a cancellation
        console.error('Failed to import recording:', result.error)
      }
    } catch (e) {
      console.error('Failed to import recording:', e)
    }
  }

  // Bulk download all device-only recordings via centralized service
  const handleBulkDownload = async () => {
    const deviceOnlyRecordings = filteredRecordings.filter(r => isDeviceOnly(r))
    if (deviceOnlyRecordings.length === 0) return
    if (!deviceConnected) return

    try {
      // Queue all downloads at once - OperationController handles them sequentially
      // IMPORTANT: Pass dateCreated to preserve original recording dates from device
      await window.electronAPI.downloadService.queueDownloads(
        deviceOnlyRecordings.map(r => ({
          filename: r.deviceFilename,
          size: r.size,
          dateCreated: r.dateRecorded.toISOString()
        }))
      )
    } catch (e) {
      console.error('Failed to queue bulk downloads:', e)
    }
  }

  // Bulk process all local recordings that need transcription
  const handleBulkProcess = async () => {
    const needsProcessing = filteredRecordings.filter(r =>
      hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
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

  // Count recordings that can be bulk processed
  const bulkCounts = useMemo(() => {
    const deviceOnly = filteredRecordings.filter(r => isDeviceOnly(r)).length
    const needsTranscription = filteredRecordings.filter(r =>
      hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    ).length
    return { deviceOnly, needsTranscription }
  }, [filteredRecordings])

  // Delete handlers
  const handleDeleteFromDevice = async (recording: UnifiedRecording) => {
    if (!deviceConnected) return
    if (!window.confirm(`Delete "${recording.filename}" from device? This cannot be undone.`)) return

    setDeleting(recording.id)
    try {
      await window.electronAPI.device.deleteFile(recording.deviceFilename)
      await refresh(false)
    } catch (e) {
      console.error('Failed to delete from device:', e)
    } finally {
      setDeleting(null)
    }
  }

  const handleDeleteLocal = async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) return
    const hasTranscript = transcripts.has(recording.id)
    const message = hasTranscript
      ? `Delete local file and transcript for "${recording.filename}"? The transcript data will be lost.`
      : `Delete local file "${recording.filename}"?`
    if (!window.confirm(message)) return

    setDeleting(recording.id)
    try {
      await window.electronAPI.recordings.delete(recording.id)
      await refresh(false)
    } catch (e) {
      console.error('Failed to delete local file:', e)
    } finally {
      setDeleting(null)
    }
  }

  // Status icon component
  const StatusIcon = ({ recording }: { recording: UnifiedRecording }) => {
    switch (recording.location) {
      case 'device-only':
        return (
          <div className="flex items-center gap-1 text-orange-600 dark:text-orange-400" title="On device only">
            <Cloud className="h-4 w-4" />
          </div>
        )
      case 'local-only':
        return (
          <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400" title="Downloaded">
            <HardDrive className="h-4 w-4" />
          </div>
        )
      case 'both':
        return (
          <div className="flex items-center gap-1 text-green-600 dark:text-green-400" title="Synced">
            <Check className="h-4 w-4" />
          </div>
        )
    }
  }

  // Virtualization setup - only render visible items for performance with large lists
  const parentRef = useRef<HTMLDivElement>(null)

  // Estimate row height based on view mode and expanded state
  const estimateSize = useCallback((index: number) => {
    if (compactView) {
      return 52 // Fixed height for compact rows
    }
    const recording = filteredRecordings[index]
    if (!recording) return 200

    // Base card height
    let height = 120

    // Add height for audio player if playing
    if (currentlyPlayingId === recording.id) height += 80

    // Add height for linked meeting
    if (recording.meetingId && meetings.get(recording.meetingId)) height += 70

    // Add height for transcript section
    const transcript = transcripts.get(recording.id)
    if (transcript) {
      height += 50 // Collapsed transcript header
      if (expandedTranscripts.has(recording.id)) {
        height += 400 // Expanded transcript content (approximate)
      }
    }

    // Device-only notice
    if (isDeviceOnly(recording)) height += 30

    return height
  }, [compactView, filteredRecordings, currentlyPlayingId, meetings, transcripts, expandedTranscripts])

  const rowVirtualizer = useVirtualizer({
    count: filteredRecordings.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5, // Render 5 extra items above/below viewport for smoother scrolling
  })

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
      <header className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Knowledge Library</h1>
            <p className="text-sm text-muted-foreground">
              {stats.total} capture{stats.total !== 1 ? 's' : ''}
              {stats.unsynced > 0 && (
                <span className="ml-2 text-orange-600 dark:text-orange-400">
                  ({stats.unsynced} on device only)
                </span>
              )}
              {!deviceConnected && stats.deviceOnly === 0 && (
                <span className="ml-2 text-muted-foreground">(device not connected)</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleAddRecording} title="Import audio file">
              <Plus className="h-4 w-4 mr-2" />
              Add Capture
            </Button>
            <Button variant="outline" size="sm" onClick={openRecordingsFolder}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Open Folder
            </Button>
            {/* Bulk Actions */}
            {bulkCounts.deviceOnly > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkDownload}
                disabled={downloadQueue.size > 0 || !deviceConnected}
                title={`Download ${bulkCounts.deviceOnly} captures from device`}
              >
                {downloadQueue.size > 0 ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download All ({bulkCounts.deviceOnly})
                  </>
                )}
              </Button>
            )}
            {bulkCounts.needsTranscription > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkProcess}
                disabled={bulkProcessing}
                title={`Queue ${bulkCounts.needsTranscription} captures for transcription`}
              >
                {bulkProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {bulkProgress.current}/{bulkProgress.total}
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    Process All ({bulkCounts.needsTranscription})
                  </>
                )}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => refresh(true)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {/* View Toggle */}
            <div className="flex items-center border rounded-md overflow-hidden ml-2">
              <Button
                variant={compactView ? 'ghost' : 'default'}
                size="sm"
                onClick={() => setCompactView(false)}
                className="rounded-none border-0 px-2"
                title="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={compactView ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCompactView(true)}
                className="rounded-none border-0 border-l px-2"
                title="List view"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-4 mt-4">
          {/* Location filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="flex rounded-lg border overflow-hidden">
              <button
                onClick={() => setLocationFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  locationFilter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                All ({stats.total})
              </button>
              <button
                onClick={() => setLocationFilter('device-only')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                  locationFilter === 'device-only'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <Cloud className="h-3 w-3 inline mr-1" />
                Device ({stats.deviceOnly})
              </button>
              <button
                onClick={() => setLocationFilter('local-only')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                  locationFilter === 'local-only'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <HardDrive className="h-3 w-3 inline mr-1" />
                Downloaded ({stats.localOnly})
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search captures..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8"
            />
          </div>
        </div>
      </header>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 px-6 py-3 bg-destructive/10 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Content - Virtualized for performance with 1000+ recordings */}
      <div ref={parentRef} className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {filteredRecordings.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Mic className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                {recordings.length === 0 ? (
                  <>
                    <h3 className="text-lg font-medium mb-2">No Knowledge Captured Yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Connect your HiDock device to sync your captured conversations,
                      or import audio files from your computer.
                    </p>
                    <div className="flex gap-2 justify-center">
                      <Button onClick={() => navigate('/device')}>
                        Go to Device
                      </Button>
                      <Button variant="outline" onClick={handleAddRecording}>
                        <Plus className="h-4 w-4 mr-2" />
                        Import File
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-medium mb-2">No Matching Captures</h3>
                    <p className="text-muted-foreground">
                      Try changing your filter or search query.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            /* Virtualized List - renders only visible items */
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {compactView ? (
                /* Compact List View - Virtualized */
                <div className="border rounded-lg overflow-hidden">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = filteredRecordings[virtualRow.index]
                    const canPlay = hasLocalPath(recording)
                    const meeting = recording.meetingId ? meetings.get(recording.meetingId) : undefined

                    return (
                      <div
                        key={recording.id}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        className={`flex items-center justify-between p-3 hover:bg-muted/50 ${
                          virtualRow.index > 0 ? 'border-t' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <StatusIcon recording={recording} />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{recording.filename}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(recording.dateRecorded.toISOString())}
                              {recording.duration ? ` • ${formatDuration(recording.duration)}` : ''}
                              {meeting ? ` • ${meeting.subject}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            recording.transcriptionStatus === 'complete'
                              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                              : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'
                              ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                              : recording.transcriptionStatus === 'error'
                              ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                              : 'bg-secondary'
                          }`}>
                            {recording.transcriptionStatus === 'none' ? '—' : recording.transcriptionStatus}
                          </span>
                          {isDeviceOnly(recording) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => handleDownload(recording)}
                              disabled={!deviceConnected || isDownloading(recording.deviceFilename)}>
                              {isDownloading(recording.deviceFilename) ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => currentlyPlayingId === recording.id
                              ? audioControls.stop()
                              : audioControls.play(recording.id, recording.localPath)}
                            disabled={!canPlay}>
                            {currentlyPlayingId === recording.id ? <X className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                          </Button>
                          {/* Delete buttons - compact view */}
                          {recording.location === 'device-only' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteFromDevice(recording)}
                              disabled={!deviceConnected || deleting === recording.id}>
                              {deleting === recording.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                            </Button>
                          )}
                          {recording.location === 'local-only' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-500 hover:text-orange-600"
                              onClick={() => handleDeleteLocal(recording)}
                              disabled={deleting === recording.id}>
                              {deleting === recording.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                            </Button>
                          )}
                          {recording.location === 'both' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-orange-500"
                              onClick={() => handleDeleteLocal(recording)}
                              disabled={deleting === recording.id}>
                              {deleting === recording.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* Card View - Virtualized */
                <div className="space-y-4">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const recording = filteredRecordings[virtualRow.index]
                    const transcript = transcripts.get(recording.id)
                    const meeting = recording.meetingId ? meetings.get(recording.meetingId) : undefined
                    const canPlay = hasLocalPath(recording)

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
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <Card>
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <StatusIcon recording={recording} />
                                <div>
                                  <CardTitle className="text-base">{recording.title || recording.filename}</CardTitle>
                                  <CardDescription>
                                    {formatDateTime(recording.dateRecorded.toISOString())}
                                    {recording.size && ` • ${formatBytes(recording.size)}`}
                                    {recording.duration && ` • ${formatDuration(recording.duration)}`}
                                  </CardDescription>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {/* Quality badge */}
                                {recording.quality && (
                                  <span className={`text-xs px-2 py-1 rounded-full ${
                                    recording.quality === 'valuable'
                                      ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                                      : recording.quality === 'archived'
                                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                                      : 'bg-secondary'
                                  }`}>
                                    {recording.quality}
                                  </span>
                                )}

                                {/* Transcription status badge */}
                                <span className={`text-xs px-2 py-1 rounded-full ${
                                  recording.transcriptionStatus === 'complete'
                                    ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                    : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'
                                    ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                                    : recording.transcriptionStatus === 'error'
                                    ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                                    : 'bg-secondary'
                                }`}>
                                  {recording.transcriptionStatus === 'none' ? 'not transcribed' : recording.transcriptionStatus}
                                </span>

                                {/* Download button for device-only recordings */}
                                {isDeviceOnly(recording) && (
                                  isDownloading(recording.deviceFilename) ? (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                      {downloadQueue.get(recording.deviceFilename)?.progress ?? 0}%
                                    </div>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDownload(recording)}
                                      disabled={!deviceConnected}
                                      title={deviceConnected ? 'Download to computer' : 'Device not connected'}
                                    >
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  )
                                )}

                                {/* Play button */}
                                {currentlyPlayingId === recording.id ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => audioControls.stop()}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => audioControls.play(recording.id, recording.localPath)}
                                    disabled={!canPlay}
                                    title={canPlay ? 'Play capture' : 'Download to play'}
                                  >
                                    <Play className="h-4 w-4" />
                                  </Button>
                                )}

                                {/* Delete buttons based on location */}
                                {recording.location === 'device-only' && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteFromDevice(recording)}
                                    disabled={!deviceConnected || deleting === recording.id}
                                    title="Delete from device"
                                  >
                                    {deleting === recording.id ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                                {recording.location === 'local-only' && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-orange-500 hover:text-orange-600"
                                    onClick={() => handleDeleteLocal(recording)}
                                    disabled={deleting === recording.id}
                                    title="Delete local file"
                                  >
                                    {deleting === recording.id ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                                {recording.location === 'both' && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-orange-500"
                                    onClick={() => handleDeleteLocal(recording)}
                                    disabled={deleting === recording.id}
                                    title="Delete local copy"
                                  >
                                    {deleting === recording.id ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {/* Audio Player */}
                            {currentlyPlayingId === recording.id && hasLocalPath(recording) && (
                              <AudioPlayer
                                filename={recording.filename}
                                onClose={() => audioControls.stop()}
                              />
                            )}

                            {/* Linked Meeting */}
                            {meeting && (
                              <div
                                className="flex items-center gap-2 p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80"
                                onClick={() => navigate(`/meeting/${meeting.id}`)}
                              >
                                <Calendar className="h-4 w-4 text-primary" />
                                <div>
                                  <p className="text-sm font-medium">{meeting.subject}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatDateTime(meeting.start_time)}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Transcript */}
                            {transcript && (
                              <div className="border rounded-lg">
                                <button
                                  className="w-full flex items-center justify-between p-3 hover:bg-muted/50"
                                  onClick={() => toggleTranscript(recording.id)}
                                >
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4" />
                                    <span className="font-medium text-sm">Transcript</span>
                                    {transcript.word_count && (
                                      <span className="text-xs text-muted-foreground">
                                        ({transcript.word_count} words)
                                      </span>
                                    )}
                                  </div>
                                  {expandedTranscripts.has(recording.id) ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </button>

                                {expandedTranscripts.has(recording.id) && (
                                  <div className="p-3 pt-0 space-y-3">
                                    {/* Summary */}
                                    {transcript.summary && (
                                      <div className="p-3 bg-muted rounded-lg">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                                        <p className="text-sm">{transcript.summary}</p>
                                      </div>
                                    )}

                                    {/* Action Items */}
                                    {transcript.action_items && (
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Action Items</p>
                                        <ul className="list-disc list-inside text-sm space-y-1">
                                          {parseJsonArray<string>(transcript.action_items).map((item, i) => (
                                            <li key={i}>{item}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Key Points */}
                                    {transcript.key_points && (
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Key Points</p>
                                        <ul className="list-disc list-inside text-sm space-y-1">
                                          {parseJsonArray<string>(transcript.key_points).map((item, i) => (
                                            <li key={i}>{item}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Topics */}
                                    {transcript.topics && (
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Topics</p>
                                        <div className="flex flex-wrap gap-1">
                                          {parseJsonArray<string>(transcript.topics).map((topic, i) => (
                                            <span key={i} className="px-2 py-0.5 bg-secondary text-xs rounded-full">
                                              {topic}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Full Text */}
                                    <details className="mt-2">
                                      <summary className="text-sm text-primary cursor-pointer hover:underline">
                                        View full transcript
                                      </summary>
                                      <p className="mt-2 text-sm whitespace-pre-wrap bg-muted p-3 rounded-lg max-h-64 overflow-auto">
                                        {transcript.full_text}
                                      </p>
                                    </details>

                                    {/* Metadata */}
                                    <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t">
                                      {transcript.language && (
                                        <span>Language: {transcript.language}</span>
                                      )}
                                      {transcript.transcription_provider && (
                                        <span>Provider: {transcript.transcription_provider}</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Device-only notice */}
                            {isDeviceOnly(recording) && (
                              <p className="text-xs text-muted-foreground italic">
                                Download this capture to play it and generate a transcript.
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
