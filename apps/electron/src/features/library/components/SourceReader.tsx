/**
 * SourceReader Component
 *
 * Displays the selected recording in the center panel with:
 * - Audio playback controls
 * - Transcript viewer with timestamps
 * - Metadata display (editable when knowledgeCaptureId is present)
 *
 * Shows a placeholder message when no recording is selected.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { TranscriptViewer, type StoredSegment } from './TranscriptViewer'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { StatusIcon } from './StatusIcon'
import { getDisplayTitle } from '@/features/library/utils/getDisplayTitle'
import { useUIStore } from '@/store/useUIStore'
import { AudioPlayer } from '@/components/AudioPlayer'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { Transcript, Meeting, Contact, MeetingAttendee, parseJsonArray, parseAttendees } from '@/types'
import { Calendar, Download, Trash2, Wand2, RefreshCw, Play, Square, Pencil, Check, Edit2, Link, X, ExternalLink, FolderOpen, MoreHorizontal, Folder, Plus, EyeOff, Eye, Sparkles, ChevronDown, Cloud, Cpu, Users, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

/** Minimal project shape the assignment picker needs (id + name). */
type PickerProject = { id: string; name: string }
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select'
import { toast } from '@/components/ui/toaster'
import { RecordingLinkDialog } from '@/components/RecordingLinkDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDateTime, formatDuration, formatBytes, cn } from '@/lib/utils'
import { formatSmartDate, formatRelativeDate } from '@/lib/smartDate'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'

const CATEGORY_OPTIONS = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'interview', label: 'Interview' },
  { value: '1:1', label: '1:1' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'note', label: 'Note' },
  { value: 'other', label: 'Other' },
] as const

interface SourceReaderProps {
  recording: UnifiedRecording | null
  transcript?: Transcript
  meeting?: Meeting
  isPlaying?: boolean
  currentTimeMs?: number
  onPlay?: () => void
  onStop?: () => void
  onSeek?: (startMs: number, endMs?: number) => void
  // Action button callbacks
  onDownload?: () => void
  onTranscribe?: () => void
  onReprocessVibeVoice?: () => void
  onDelete?: () => void
  onDeletePermanent?: () => void
  onMarkPersonal?: () => void
  // State for button enabling/disabling
  deviceConnected?: boolean
  isDownloading?: boolean
  downloadProgress?: number
  isDeleting?: boolean
  // Navigation
  onNavigateToMeeting?: (meetingId: string) => void
  // Metadata editing callback
  onMetadataEdited?: () => void
  // Opens the source-scoped AI assistant drawer/overlay for this recording.
  onAskAboutSource?: () => void
}

export function SourceReader({
  recording,
  transcript,
  meeting,
  isPlaying = false,
  currentTimeMs = 0,
  onPlay,
  onStop,
  onSeek,
  onDownload,
  onTranscribe,
  // onReprocessVibeVoice is intentionally not consumed: the raw "VibeVoice"
  // button was replaced by the "Transcribe ▾" method picker below. The prop
  // remains in the interface so existing callers (Library) still type-check.
  onDelete,
  onDeletePermanent,
  onMarkPersonal,
  deviceConnected = false,
  isDownloading = false,
  downloadProgress,
  isDeleting = false,
  onNavigateToMeeting,
  onMetadataEdited,
  onAskAboutSource
}: SourceReaderProps) {

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [isSavingTitle, setIsSavingTitle] = useState(false)

  // Category saving state
  const [isSavingCategory, setIsSavingCategory] = useState(false)

  // Meeting link dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)

  // Transcription warning state. `pendingTranscribe` holds the exact action to
  // run once the user confirms past the "may overwrite your edits" dialog — this
  // lets the same warning guard both the primary Transcribe and the explicit
  // per-method (Gemini / Local) choices.
  const [metadataEdited, setMetadataEdited] = useState(false)
  const [showTranscribeWarning, setShowTranscribeWarning] = useState(false)
  const [pendingTranscribe, setPendingTranscribe] = useState<(() => void) | null>(null)

  // Sidebar transcription dock mirror — kept in sync when we queue via the
  // explicit-method picker (same as useOperations does for the default path).
  const addToQueue = useTranscriptionStore((s) => s.addToQueue)

  // Live duration: imported/watched files have no stored duration until the
  // waveform decode backfills it; show the freshly-decoded value meanwhile.
  const livePlaybackDuration = useUIStore((s) => s.playbackDuration)
  const waveformLoadedForId = useUIStore((s) => s.waveformLoadedForId)

  // Reset all state when recording changes
  useEffect(() => {
    setIsEditingTitle(false)
    setEditedTitle('')
    setLinkDialogOpen(false)
    setMetadataEdited(false)
    setShowTranscribeWarning(false)
    setPendingTranscribe(null)
  }, [recording?.id])

  // Preload the waveform as soon as a playable recording is opened, so the
  // reader shows the visualization immediately instead of "Press Play to load
  // the waveform". The same decode backfills+persists the real duration, which
  // is why an imported file's header stops reading "Unknown". No-op when the
  // waveform for this recording is already loaded or currently loading, and a
  // safe no-op in tests where window.__audioControls is undefined.
  const recordingId = recording?.id
  const localPath = recording && hasLocalPath(recording) ? recording.localPath : undefined
  useEffect(() => {
    if (!recordingId || !localPath) return
    const { waveformLoadedForId: loadedId, waveformLoadingId } = useUIStore.getState()
    if (loadedId === recordingId || waveformLoadingId === recordingId) return
    window.__audioControls?.loadWaveformOnly(recordingId, localPath)
  }, [recordingId, localPath])

  const handleSaveTitle = useCallback(async () => {
    if (!recording?.knowledgeCaptureId) return
    const trimmed = editedTitle.trim()
    if (!trimmed) {
      setEditedTitle(recording.title || recording.filename)
      toast.error('Title cannot be empty')
      return
    }
    if (trimmed === (recording.title || recording.filename)) {
      setIsEditingTitle(false)
      return
    }
    setIsSavingTitle(true)
    try {
      const result = await window.electronAPI.knowledge.update(
        recording.knowledgeCaptureId,
        { title: trimmed }
      )
      if (result.success) {
        setIsEditingTitle(false)
        setMetadataEdited(true)
        toast.success('Title updated')
        onMetadataEdited?.()
      } else {
        toast.error('Failed to save title')
      }
    } catch (err) {
      console.error('Failed to save title:', err)
      toast.error('Failed to save title')
    } finally {
      setIsSavingTitle(false)
    }
  }, [editedTitle, recording, onMetadataEdited])

  const handleCancelTitle = useCallback(() => {
    setIsEditingTitle(false)
    setEditedTitle('')
  }, [])

  const handleCategoryChange = useCallback(async (newCategory: string) => {
    if (!recording?.knowledgeCaptureId) return
    if (newCategory === recording.category) return
    setIsSavingCategory(true)
    try {
      const result = await window.electronAPI.knowledge.update(
        recording.knowledgeCaptureId,
        { category: newCategory }
      )
      if (result.success) {
        setMetadataEdited(true)
        toast.success('Category updated')
        onMetadataEdited?.()
      } else {
        toast.error('Failed to save category')
      }
    } catch (err) {
      console.error('Failed to save category:', err)
      toast.error('Failed to save category')
    } finally {
      setIsSavingCategory(false)
    }
  }, [recording, onMetadataEdited])

  const handleRemoveMeetingLink = useCallback(async () => {
    if (!recording) return
    try {
      await window.electronAPI.recordings.selectMeeting(recording.id, null)
      setMetadataEdited(true)
      onMetadataEdited?.()
    } catch (err) {
      console.error('Failed to remove meeting link:', err)
      toast.error('Failed to remove meeting link')
    }
  }, [recording, onMetadataEdited])

  // Run a transcription action, but first warn if the user edited metadata the
  // AI pass could overwrite. The chosen action is stashed and executed on
  // confirm (see the ConfirmDialog below), so the same guard covers both the
  // primary Transcribe and the explicit Gemini/Local method choices.
  const requestTranscribe = useCallback((action: () => void) => {
    if (metadataEdited) {
      setPendingTranscribe(() => action)
      setShowTranscribeWarning(true)
    } else {
      action()
    }
  }, [metadataEdited])

  // Queue a transcription with an explicit method — "Gemini" (cloud) or "Local"
  // (on-device) — reusing the existing recordings:reprocessWith IPC. This does
  // NOT touch the transcription service; it mirrors useOperations' toast + the
  // sidebar dock-queue update so the run is observable there too.
  const transcribeWith = useCallback(async (provider: 'gemini' | 'local-asr', label: string) => {
    if (!recording || !hasLocalPath(recording)) return
    try {
      const res = await window.electronAPI.recordings.reprocessWith(recording.id, provider)
      if (!res?.success) {
        toast.error('Failed to transcribe', res?.error || `Could not start ${label} transcription`)
        return
      }
      if (res.queueItemId) addToQueue(res.queueItemId, recording.id, recording.filename)
      toast.success(`Transcribing with ${label}`, recording.filename)
    } catch (err) {
      toast.error('Failed to transcribe', err instanceof Error ? err.message : undefined)
    }
  }, [recording, addToQueue])

  // Parse the stored speaker/timestamp segments (Gemini or local ASR write
  // `speakers` as a JSON array of {speaker, start, end, text}). When present,
  // the viewer renders structured turns instead of re-parsing the plain text.
  // MUST stay above the early return: it guards on `transcript` (a prop), so it
  // runs unconditionally and keeps hook order stable whether or not a recording
  // is selected — otherwise selecting one adds a hook and React throws
  // "Rendered more hooks than during the previous render."
  const transcriptSegments = useMemo<StoredSegment[] | undefined>(() => {
    if (!transcript?.speakers) return undefined
    try {
      const parsed = JSON.parse(transcript.speakers)
      return Array.isArray(parsed) && parsed.length > 0 ? (parsed as StoredSegment[]) : undefined
    } catch {
      return undefined
    }
  }, [transcript?.speakers])

  if (!recording) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">No recording selected</p>
          <p className="text-sm">Select a recording from the list to view details</p>
        </div>
      </div>
    )
  }

  const canPlay = hasLocalPath(recording)

  // Same title resolver the list row uses, so clicking a row and the detail
  // header always agree (no raw filename leaking through here).
  const { primaryText: displayTitle } = getDisplayTitle(recording, meeting, transcript)

  // Prefer the stored duration; fall back to the live decoded value for the
  // recording whose waveform is currently loaded.
  const durationSeconds = recording.duration && recording.duration > 0
    ? recording.duration
    : waveformLoadedForId === recording.id && livePlaybackDuration > 0
      ? livePlaybackDuration
      : 0

  // Transcription is "busy" while queued or running — the primary Transcribe
  // control and its ▾ trigger are disabled in that window.
  const isTranscribeBusy =
    recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'

  // The two human-named transcription methods offered by the ▾ menu. Shared by
  // both the "Transcribe ▾" (fresh) and "Re-transcribe ▾" (already-done) forms.
  const transcribeMenuItems = (
    <>
      <DropdownMenuItem onClick={() => requestTranscribe(() => transcribeWith('gemini', 'Gemini'))}>
        <Cloud className="h-4 w-4" aria-hidden="true" />
        Gemini (cloud)
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => requestTranscribe(() => transcribeWith('local-asr', 'Local'))}>
        <Cpu className="h-4 w-4" aria-hidden="true" />
        Local (on-device)
      </DropdownMenuItem>
    </>
  )

  const linkDialogRecording = {
    id: recording.id,
    filename: recording.filename,
    date_recorded: recording.dateRecorded instanceof Date
      ? recording.dateRecorded.toISOString()
      : String(recording.dateRecorded),
    duration_seconds: recording.duration ?? null
  }

  return (
    <div className="@container flex flex-col h-full overflow-hidden">
      {/* Single scroll container so the transcript is always reachable even when
          the pane is short; the audio player sticks to the top while scrolling. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Header with comprehensive metadata */}
      <div className="p-6 border-b space-y-4">
        <div>
          <div className="mb-4">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle()
                    if (e.key === 'Escape') handleCancelTitle()
                  }}
                  className="text-xl font-semibold h-auto py-1"
                  autoFocus
                  disabled={isSavingTitle}
                  aria-label="Recording title"
                />
                <Button variant="ghost" size="sm" onClick={handleSaveTitle} disabled={isSavingTitle} aria-label="Save title" title="Save (Enter)">
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancelTitle} disabled={isSavingTitle} aria-label="Cancel editing" title="Cancel (Escape)">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="group flex items-center gap-2">
                <h2 className="text-xl font-semibold line-clamp-2 leading-tight" title={displayTitle}>
                  {displayTitle}
                </h2>
                {recording.knowledgeCaptureId && (
                  <button
                    onClick={() => {
                      setIsEditingTitle(true)
                      setEditedTitle(recording.title || displayTitle)
                    }}
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    aria-label="Edit title"
                    title="Edit title"
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Comprehensive Metadata Grid - same as SourceRowExpanded */}
          <div className="grid grid-cols-2 @md:grid-cols-3 @xl:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Date Recorded</p>
              {/* Absolute date WITH the year (formatSmartDate) + a relative hint
                  (formatRelativeDate) so a year-old recording never reads like
                  this week's. */}
              <p>{formatSmartDate(recording.dateRecorded, { fallback: 'Unknown' })}</p>
              {(() => {
                const rel = formatRelativeDate(recording.dateRecorded)
                return rel ? <p className="text-xs text-muted-foreground">{rel}</p> : null
              })()}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Duration</p>
              <p>{durationSeconds > 0 ? formatDuration(durationSeconds) : 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Size</p>
              <p>{recording.size ? formatBytes(recording.size) : 'Unknown'}</p>
            </div>
            {/* Quality (value rating) — only shown when actually rated; the old
                'Standard' fallback was a meaningless placeholder. */}
            {recording.quality && recording.quality !== 'unrated' && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Quality</p>
                <p className="capitalize">{recording.quality.replace('-', ' ')}</p>
              </div>
            )}
            {recording.knowledgeCaptureId ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Category</p>
                <Select
                  value={recording.category || ''}
                  onValueChange={handleCategoryChange}
                  disabled={isSavingCategory}
                >
                  <SelectTrigger className="h-7 text-sm w-[140px]">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : recording.category ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Category</p>
                <p className="capitalize">{recording.category}</p>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Location</p>
              {/* Icon-only (with tooltip/aria) — the verbose text was redundant */}
              <StatusIcon recording={recording} />
            </div>
            <div>
              {/* No caption: the badge ("Transcribed", "Queued", …) is self-labelling.
                  Invisible spacer keeps it aligned with the other cells' values. */}
              <p className="text-xs font-medium mb-1 invisible select-none" aria-hidden="true">Status</p>
              <TranscriptionStatusBadge status={recording.transcriptionStatus} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Filename</p>
              <p className="truncate" title={recording.filename}>{recording.filename}</p>
            </div>
          </div>

          {/* Projects assignment (only for captured recordings) */}
          {recording.knowledgeCaptureId && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Projects</p>
              <ProjectAssignmentRow knowledgeCaptureId={recording.knowledgeCaptureId} />
            </div>
          )}

          {/* Linked Meeting */}
          {meeting && (
            <div className="mt-4 flex items-center gap-2 p-3 bg-muted/30 border rounded-lg">
              <div
                className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => onNavigateToMeeting?.(meeting.id)}
              >
                <Calendar className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{meeting.subject}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(meeting.start_time)}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={(e) => { e.stopPropagation(); setLinkDialogOpen(true) }}
                title="Change linked meeting"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); handleRemoveMeetingLink() }}
                title="Remove meeting link"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* People: two DISTINCT lists — who actually spoke (Participants) vs.
              who was calendar-invited (Invited). Only mounted when there's a
              linked meeting or transcript speaker turns to draw from, so the
              react-router-dependent PeoplePanel never renders for a bare
              recording (keeps Router-less unit tests valid). */}
          {(meeting || (transcriptSegments && transcriptSegments.length > 0)) && (
            <PeoplePanel meeting={meeting} segments={transcriptSegments} />
          )}

          {/* Device-only notice */}
          {isDeviceOnly(recording) && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              Download this capture to play it and generate a transcript.
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons Section — one primary action, the rest demoted to
          secondary or an overflow menu so the row has a clear hierarchy and
          doesn't duplicate the bulk-actions bar. */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b bg-muted/30">
        {/* Primary action: Play/Stop for local files, Download for device-only */}
        {canPlay && onPlay ? (
          isPlaying ? (
            <Button size="sm" onClick={onStop} className="gap-2" title="Stop playback">
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={onPlay} className="gap-2" title="Play recording">
              <Play className="h-4 w-4" />
              Play
            </Button>
          )
        ) : isDeviceOnly(recording) && onDownload ? (
          <Button
            size="sm"
            onClick={onDownload}
            disabled={!deviceConnected || isDownloading}
            className="gap-2"
            title={!deviceConnected ? 'Device not connected' : 'Download recording from device'}
          >
            {isDownloading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                {downloadProgress !== undefined ? `${downloadProgress}%` : 'Downloading...'}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download
              </>
            )}
          </Button>
        ) : null}

        {/* Transcription: a "Transcribe ▾" split button. The primary triggers a
            transcription with the configured default method; the ▾ menu lets the
            user pick a specific method by human name (Gemini / Local). Replaces
            the old raw "VibeVoice" button. Shown for local files only. */}
        {hasLocalPath(recording) && (
          recording.transcriptionStatus === 'complete' ? (
            // Already transcribed → offer a re-run by explicit method.
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" title="Re-transcribe with a chosen method">
                  <Wand2 className="h-4 w-4" />
                  Re-transcribe
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">{transcribeMenuItems}</DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // Not yet transcribed → primary Transcribe (default) + ▾ method picker.
            <div className="inline-flex items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => requestTranscribe(() => onTranscribe?.())}
                disabled={isTranscribeBusy}
                className="gap-2 rounded-r-none border-r-0"
                title={
                  recording.transcriptionStatus === 'pending' ? 'Transcription queued' :
                  recording.transcriptionStatus === 'processing' ? 'Transcription in progress' :
                  'Start AI transcription (configured default method)'
                }
              >
                {recording.transcriptionStatus === 'processing' ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    In Progress
                  </>
                ) : recording.transcriptionStatus === 'pending' ? (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Queued
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    Transcribe
                  </>
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isTranscribeBusy}
                    className="rounded-l-none px-2"
                    aria-label="Choose transcription method"
                    title="Choose transcription method"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">{transcribeMenuItems}</DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        )}

        {/* Source-scoped assistant: opens the dockable "Ask about this source"
            drawer for the selected recording. */}
        {onAskAboutSource && (
          <Button
            variant="outline"
            size="sm"
            onClick={onAskAboutSource}
            className="gap-2"
            title="Ask the AI assistant about this source"
          >
            <Sparkles className="h-4 w-4" />
            Ask about this source
          </Button>
        )}

        {/* Overflow: file operations + destructive delete (behind a separator) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="More actions" title="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {hasLocalPath(recording) && (
              <>
                <DropdownMenuItem onClick={() => window.electronAPI?.storage.openFile(recording.localPath)}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open in default app
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.electronAPI?.storage.revealInFolder(recording.localPath)}>
                  <FolderOpen className="h-4 w-4" aria-hidden="true" />
                  Reveal in folder
                </DropdownMenuItem>
              </>
            )}
            {!meeting && !isDeviceOnly(recording) && (
              <DropdownMenuItem onClick={() => setLinkDialogOpen(true)}>
                <Link className="h-4 w-4" aria-hidden="true" />
                Link meeting
              </DropdownMenuItem>
            )}
            {onMarkPersonal && !isDeviceOnly(recording) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onMarkPersonal}>
                  {recording.personal
                    ? <><Eye className="h-4 w-4" aria-hidden="true" />Unmark personal</>
                    : <><EyeOff className="h-4 w-4" aria-hidden="true" />Mark personal (ignore)</>}
                </DropdownMenuItem>
              </>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  disabled={(isDeviceOnly(recording) && !deviceConnected) || isDeleting}
                  className="text-destructive focus:text-destructive"
                >
                  {isDeleting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isDeviceOnly(recording) ? 'Delete from device'
                    : recording.location === 'local-only' ? 'Delete from computer'
                      : 'Delete everywhere'}
                </DropdownMenuItem>
                {onDeletePermanent && !isDeviceOnly(recording) && (
                  <DropdownMenuItem
                    onClick={onDeletePermanent}
                    disabled={isDeleting}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete permanently…
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Audio Player — shown whenever recording has local file */}
      {canPlay && (
        <div className="sticky top-0 bg-background z-10 border-b">
          {/* No onClose here: the reader's player is always docked, so a
              "Close" button would mislead (it only stops). The transport's
              Square control already stops playback. */}
          <AudioPlayer
            key={recording.id}
            recordingId={recording.id}
            filePath={hasLocalPath(recording) ? recording.localPath : undefined}
            filename={recording.filename}
          />
        </div>
      )}

      {/* Transcript Content */}
      <div className="p-4">
        {transcript ? (
          <TranscriptViewer
            transcript={transcript.full_text}
            segments={transcriptSegments}
            recordingId={recording.id}
            currentTimeMs={currentTimeMs}
            isPlaying={isPlaying}
            onSeek={onSeek || (() => {})}
            showSummary={true}
            showActionItems={true}
            summary={transcript.summary ?? undefined}
            actionItems={parseJsonArray<string>(transcript.action_items)}
          />
        ) : recording.transcriptionStatus === 'complete' ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Transcript not available</p>
          </div>
        ) : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing' ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Transcription in progress...</p>
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            <p>No transcript available</p>
            {canPlay && (
              <p className="text-sm mt-2">
                Click &quot;Transcribe&quot; to generate a transcript
              </p>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Meeting link dialog */}
      <RecordingLinkDialog
        recording={linkDialogOpen ? linkDialogRecording : null}
        meeting={meeting}
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        onResolved={() => {
          // Note: RecordingLinkDialog calls both onResolved and onClose internally
          // Do NOT call setLinkDialogOpen(false) here to avoid double-close
          setMetadataEdited(true)
          onMetadataEdited?.()
        }}
      />

      {/* Transcription overwrite warning */}
      <ConfirmDialog
        open={showTranscribeWarning}
        onOpenChange={(open) => {
          setShowTranscribeWarning(open)
          if (!open) setPendingTranscribe(null)
        }}
        title="Transcription may overwrite your edits"
        description="You've manually edited this recording's metadata. The AI transcription process may overwrite your title, category, and summary changes. Do you want to continue?"
        actionLabel="Continue"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => {
          pendingTranscribe?.()
          setPendingTranscribe(null)
          setMetadataEdited(false)
          setShowTranscribeWarning(false)
        }}
      />
    </div>
  )
}

/**
 * Projects assignment for a captured recording. Shows chips of assigned projects
 * (projects.getForKnowledge) and a popover picker of all projects with checkboxes
 * (knowledge.setProjects persists the change). Own component so its hooks stay
 * isolated from SourceReader's conditional early return.
 */
function ProjectAssignmentRow({ knowledgeCaptureId }: { knowledgeCaptureId: string }) {
  const [assigned, setAssigned] = useState<PickerProject[]>([])
  const [allProjects, setAllProjects] = useState<PickerProject[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadAssigned = useCallback(async () => {
    try {
      const res = await window.electronAPI.projects.getForKnowledge(knowledgeCaptureId)
      setAssigned(res.success ? res.data : [])
    } catch (err) {
      console.error('Failed to load assigned projects:', err)
      setAssigned([])
    }
  }, [knowledgeCaptureId])

  useEffect(() => {
    loadAssigned()
  }, [loadAssigned])

  const loadAll = useCallback(async () => {
    try {
      const res = await window.electronAPI.projects.getAll({ status: 'all' })
      if (res.success) setAllProjects(res.data.projects)
    } catch (err) {
      console.error('Failed to load projects:', err)
    }
  }, [])

  // Memoized so it doesn't rebuild every render (which would churn the
  // toggleProject callback's deps).
  const assignedIds = useMemo(() => new Set(assigned.map((p) => p.id)), [assigned])

  const toggleProject = useCallback(async (projectId: string) => {
    const nextIds = new Set(assignedIds)
    if (nextIds.has(projectId)) nextIds.delete(projectId)
    else nextIds.add(projectId)
    setSaving(true)
    try {
      const res = await window.electronAPI.knowledge.setProjects({
        knowledgeCaptureId,
        projectIds: Array.from(nextIds)
      })
      if (res.success) {
        setAssigned(allProjects.filter((p) => nextIds.has(p.id)))
      } else {
        toast.error('Failed to update projects')
      }
    } catch (err) {
      console.error('Failed to set projects:', err)
      toast.error('Failed to update projects')
    } finally {
      setSaving(false)
    }
  }, [assignedIds, allProjects, knowledgeCaptureId])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.map((p) => (
        <span
          key={p.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs border border-primary/20"
        >
          <Folder className="h-3 w-3" />
          {p.name}
        </span>
      ))}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) loadAll()
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 gap-1 text-xs" title="Assign to projects">
            <Plus className="h-3 w-3" />
            {assigned.length === 0 ? 'Assign project' : 'Edit'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <p className="text-xs font-semibold text-muted-foreground px-2 py-1">Assign to projects</p>
          <div className="max-h-64 overflow-auto">
            {allProjects.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">No projects yet.</p>
            ) : (
              allProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggleProject(p.id)}
                  disabled={saving}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <span className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border shrink-0",
                    assignedIds.has(p.id) ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
                  )}>
                    {assignedIds.has(p.id) && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{p.name}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/**
 * PeoplePanel — surfaces two DISTINCT people lists for the selected recording:
 *
 *  - Participants: who actually spoke / was detected in the meeting. Canonical
 *    contacts come from the meeting_contacts join (contacts.getForMeeting, the
 *    same source MeetingDetail uses), plus any transcript speaker labels that
 *    don't map to a known contact ("who spoke" even before a contact exists).
 *    Canonical contacts are clickable → /person/:id.
 *  - Invited: the calendar-invited attendees on the linked meeting's ICS /
 *    Outlook / M365 event (meeting.attendees JSON). This is who was INVITED,
 *    which is DIFFERENT from who spoke. Resolves to contacts where possible;
 *    shows an honest empty state when the calendar event carried no invite list.
 *
 * Own component (like ProjectAssignmentRow) so its data-loading hooks and
 * useNavigate stay isolated from SourceReader's conditional early return, and so
 * it only mounts when there's a meeting or transcript to draw people from.
 */
function PeoplePanel({ meeting, segments }: { meeting?: Meeting; segments?: StoredSegment[] }) {
  const navigate = useNavigate()
  const [contacts, setContacts] = useState<Contact[]>([])

  // Canonical contacts for the linked meeting — the meeting_contacts join. Same
  // IPC MeetingDetail uses; no new read path needed.
  const meetingId = meeting?.id
  useEffect(() => {
    let cancelled = false
    if (!meetingId) {
      setContacts([])
      return
    }
    ;(async () => {
      try {
        const res = await window.electronAPI.contacts.getForMeeting(meetingId)
        if (!cancelled) setContacts(res.success ? res.data : [])
      } catch (err) {
        console.error('Failed to load meeting contacts:', err)
        if (!cancelled) setContacts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [meetingId])

  // Distinct speaker labels from the transcript's turns — "who actually spoke".
  // Keyed lowercase so "Alice"/"alice" collapse; keeps first-seen display form.
  const speakerNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of segments ?? []) {
      const name = s.speaker?.trim()
      if (name && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), name)
    }
    return map
  }, [segments])

  // A speaker already represented by a canonical contact (by name) shouldn't be
  // listed twice — surface only the transcript speakers with no contact match.
  const contactNameKeys = useMemo(
    () =>
      new Set(
        contacts
          .map((c) => (c.name || c.email || '').trim().toLowerCase())
          .filter(Boolean)
      ),
    [contacts]
  )
  const extraSpeakers = useMemo(
    () =>
      Array.from(speakerNames.entries())
        .filter(([key]) => !contactNameKeys.has(key))
        .map(([, display]) => display),
    [speakerNames, contactNameKeys]
  )

  const participantCount = contacts.length + extraSpeakers.length

  // Invited = calendar attendees on the linked meeting. Resolve to a contact by
  // email (preferred) or name so a chip can deep-link where we know the person.
  const invited = useMemo(() => parseAttendees(meeting?.attendees), [meeting?.attendees])
  const resolveAttendee = useCallback(
    (a: MeetingAttendee): Contact | undefined => {
      const email = a.email?.trim().toLowerCase()
      const name = a.name?.trim().toLowerCase()
      return contacts.find(
        (c) =>
          (!!email && c.email?.trim().toLowerCase() === email) ||
          (!!name && c.name?.trim().toLowerCase() === name)
      )
    },
    [contacts]
  )

  // Nothing to show at all (no meeting, no speakers) → render nothing.
  if (!meeting && participantCount === 0) return null

  return (
    <div className="mt-4 space-y-3">
      {/* Participants — who actually spoke / was detected */}
      {participantCount > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Participants ({participantCount})
            <span className="font-normal text-muted-foreground/70">From transcripts</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {contacts.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/person/${c.id}`)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title={`View ${c.name || c.email}`}
              >
                {c.name || c.email}
              </button>
            ))}
            {extraSpeakers.map((name) => (
              <span
                key={`spk-${name}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/60 text-secondary-foreground text-xs"
                title={`${name} (from transcript)`}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Invited — calendar attendees (distinct from who spoke). Only meaningful
          when a calendar meeting is linked; when the event carried no invite
          list we say so plainly rather than fabricate names. */}
      {meeting && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            Invited ({invited.length})
            <span className="font-normal text-muted-foreground/70">From calendar</span>
          </p>
          {invited.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {invited.map((a, i) => {
                const contact = resolveAttendee(a)
                const label = a.name || a.email || 'Unknown'
                return contact ? (
                  <button
                    key={`inv-${i}`}
                    type="button"
                    onClick={() => navigate(`/person/${contact.id}`)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    title={`View ${label}`}
                  >
                    {label}
                  </button>
                ) : (
                  <span
                    key={`inv-${i}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs"
                    title={label}
                  >
                    {label}
                  </span>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70 italic">
              No invite list captured for this meeting.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
