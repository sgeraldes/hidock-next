/**
 * SourceReader Component
 *
 * The Library's center detail panel for a selected recording. Reworked around a
 * DOCKED header + a single SCROLL body:
 *
 *  Docked (always visible):
 *    - Title (inline-editable) + transcription status
 *    - A curated meta strip (date · duration · location)
 *    - Primary CTAs (Play/Download, Transcribe/Re-transcribe ▾, Ask, overflow)
 *    - A COMPACT player: a voice-message pill (or a bare scrubber when narrow),
 *      with an expand toggle to a smaller full waveform that has a clear playhead
 *    - Participants (who actually spoke) chips — derived from the SAME resolved
 *      speaker map the transcript uses, so a renamed speaker updates here too
 *
 *  Scrolls below:
 *    - Secondary metadata (size, filename, category, quality)
 *    - Projects, linked meeting, Invited (calendar attendees, distinct from
 *      Participants), and the Summary / Action Items / Transcript
 */

import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TranscriptViewer, type StoredSegment } from './TranscriptViewer'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { StatusIcon } from './StatusIcon'
import { WaveformPlayer, type TimelineEvent, type SentimentScorePoint, type WaveformPlayerMode } from './WaveformPlayer'
import { SpeakerAssignPopover, type AssignScope } from './SpeakerAssignPopover'
import { useReaderPeople, type ParticipantChip } from '../hooks/useReaderPeople'
import { deriveSpeakerRanges, type DerivedSpeakerRange } from '@/features/library/utils/speakerRanges'
import { getDisplayTitle } from '@/features/library/utils/getDisplayTitle'
import { useUIStore } from '@/store/useUIStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { Transcript, Meeting, MeetingAttendee, parseJsonArray } from '@/types'
import { Calendar, Download, Trash2, Wand2, RefreshCw, Play, Square, Pencil, Check, Edit2, Link, X, ExternalLink, FolderOpen, MoreHorizontal, Folder, Plus, EyeOff, Eye, Sparkles, ChevronDown, Cloud, Cpu, Users, Mail, UserCog, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { PersonHoverCard } from '@/components/entity/EntityHoverCards'

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

/** Body scrollTop (px) past which the big timeline morphs to the docked bar. */
const COLLAPSE_SCROLL_THRESHOLD = 6
/** Reader width (px) below which the docked bar drops to the bare scrubber. */
const NARROW_WIDTH_BREAKPOINT = 420

const CATEGORY_OPTIONS = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'interview', label: 'Interview' },
  { value: '1:1', label: '1:1' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'note', label: 'Note' },
  { value: 'other', label: 'Other' },
] as const

/**
 * Shape returned by the sibling "timeline-data" agent's IPC. Typed here (and the
 * call is made via an optional cast) so this file type-checks and degrades
 * gracefully BEFORE that IPC lands — colored bars + seek still work without it.
 *   window.electronAPI.recordings.getTimelineAnalysis(recordingId) → this
 *   window.electronAPI.recordings.analyzeTimeline(recordingId)     → backfill
 */
interface TimelineAnalysisResult {
  sentimentSegments?: Array<{ startSec: number; endSec: number; score: number }>
  eventMarkers?: Array<{ id: string; kind: 'action' | 'decision'; atSec: number; label: string; refId?: string }>
}

interface TimelineData {
  events: TimelineEvent[]
  sentiment: SentimentScorePoint[]
}

/** Map the IPC result into the WaveformPlayer's props (1-based marker numbers). */
function mapTimelineAnalysis(res: TimelineAnalysisResult): TimelineData {
  const events = (res.eventMarkers ?? [])
    .slice()
    .sort((a, b) => a.atSec - b.atSec)
    .map((m, i) => ({
      id: m.id,
      timeSec: m.atSec,
      index: i + 1,
      label: m.label,
      kind: m.kind,
      refId: m.refId
    }))
  const sentiment = (res.sentimentSegments ?? []).map((s) => ({
    startSec: s.startSec,
    endSec: s.endSec,
    score: s.score
  }))
  return { events, sentiment }
}

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

  // The reader hosts ONE waveform element. It is the big rich timeline by DEFAULT
  // (reader scrolled to top) and morphs into a full-width docked bar as the body
  // scrolls. `waveformPinned` (persisted) is the explicit "keep expanded" pin: it
  // overrides the scroll-collapse so the big timeline stays open while scrolling.
  const waveformPinned = useLibraryStore((s) => s.waveformPinned)
  const setWaveformPinned = useLibraryStore((s) => s.setWaveformPinned)

  // Scroll-driven collapse: the body scroll container tells the player whether the
  // reader is scrolled past the top. true → morph big → docked bar (unless pinned).
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)

  // Rich timeline analysis (event markers + sentiment) for full mode, fetched
  // from the sibling IPC when a recording opens. Null until (and if) it resolves.
  const [timeline, setTimeline] = useState<TimelineData | null>(null)
  // True while a one-time analyzeTimeline() backfill is computing sentiment +
  // markers for an already-transcribed recording (drives the subtle "Analyzing
  // timeline…" indicator). Preload does not expose the incremental
  // recordings:timelineProgress event, so the in-flight backfill promise is the
  // signal we have — shown until it resolves.
  const [analyzingTimeline, setAnalyzingTimeline] = useState(false)

  // B1 cross-highlight: clicking a numbered timeline marker (or its event-list
  // row) asks the transcript to scroll to + pulse the matching turn. The nonce
  // re-fires the pulse when the same marker is clicked twice. Reset per recording.
  const [transcriptHighlight, setTranscriptHighlight] = useState<{ atMs: number; nonce: number } | null>(null)
  const highlightNonceRef = useRef(0)

  // B3 backfill guard: recording ids whose one-time timeline analysis has already
  // been attempted while this reader stays mounted — so an already-transcribed
  // recording that legitimately yields no markers/sentiment is NOT re-analyzed on
  // every open (no loop, no repeated Gemini work). A ref (not module state) so it
  // scopes to the mounted reader session and resets cleanly between test renders.
  const backfillAttemptedRef = useRef<Set<string>>(new Set())

  // Transcription warning state. `pendingTranscribe` holds the exact action to
  // run once the user confirms past the "may overwrite your edits" dialog — this
  // lets the same warning guard both the primary Transcribe and the explicit
  // per-method (Gemini / Local) choices.
  const [metadataEdited, setMetadataEdited] = useState(false)
  const [showTranscribeWarning, setShowTranscribeWarning] = useState(false)
  const [pendingTranscribe, setPendingTranscribe] = useState<(() => void) | null>(null)

  // Re-diarize progress (mirrors re-transcribe: a transient "running" flag while
  // the new pass is queued/running).
  const [reDiarizing, setReDiarizing] = useState(false)

  // Sidebar transcription dock mirror — kept in sync when we queue via the
  // explicit-method picker (same as useOperations does for the default path).
  const addToQueue = useTranscriptionStore((s) => s.addToQueue)

  // Live duration: imported/watched files have no stored duration until the
  // waveform decode backfills it; show the freshly-decoded value meanwhile.
  const livePlaybackDuration = useUIStore((s) => s.playbackDuration)
  const waveformLoadedForId = useUIStore((s) => s.waveformLoadedForId)

  // H6: When a transcribed recording is opened via the sidebar Library nav, the
  // parent may not have enriched the `transcript` prop yet — which left the reader
  // showing "Transcript not available" and a colorless waveform. Fetch the
  // transcript directly as a fallback so the transcript + per-speaker colors render
  // on first paint, regardless of how the recording was selected.
  const [fallbackTranscript, setFallbackTranscript] = useState<Transcript | undefined>(undefined)
  const effectiveTranscript = transcript ?? fallbackTranscript

  // Reset all state when recording changes
  useEffect(() => {
    setIsEditingTitle(false)
    setEditedTitle('')
    setLinkDialogOpen(false)
    setMetadataEdited(false)
    setShowTranscribeWarning(false)
    setPendingTranscribe(null)
    setReDiarizing(false)
    setFallbackTranscript(undefined)
    setTranscriptHighlight(null)
    // A freshly-opened recording always starts at the top → big timeline.
    setScrolled(false)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [recording?.id])

  // H6: Fetch the transcript directly when the parent didn't supply one but the
  // recording is transcribed (e.g. selection arrived via the sidebar Library nav
  // before enrichment landed). No-op when a transcript prop is already present.
  useEffect(() => {
    if (transcript) return
    if (!recording || !hasLocalPath(recording)) return
    if (recording.transcriptionStatus !== 'complete') return
    let cancelled = false
    ;(async () => {
      try {
        const fetched = await window.electronAPI?.transcripts?.getByRecordingId(recording.id)
        if (!cancelled && fetched) setFallbackTranscript(fetched as Transcript)
      } catch (err) {
        console.error('[SourceReader] Transcript fallback fetch failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [recording, transcript])

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

  // Parse the stored speaker/timestamp segments (Gemini or local ASR write
  // `speakers` as a JSON array of {speaker, start, end, text}). When present,
  // the viewer renders structured turns instead of re-parsing the plain text.
  // MUST stay above the early return: it (and the people hook below) guard on
  // props, so they run unconditionally and keep hook order stable whether or not
  // a recording is selected — otherwise selecting one adds a hook and React
  // throws "Rendered more hooks than during the previous render."
  const transcriptSegments = useMemo<StoredSegment[] | undefined>(() => {
    if (!effectiveTranscript?.speakers) return undefined
    try {
      const parsed = JSON.parse(effectiveTranscript.speakers)
      return Array.isArray(parsed) && parsed.length > 0 ? (parsed as StoredSegment[]) : undefined
    } catch {
      return undefined
    }
  }, [effectiveTranscript?.speakers])

  // People (Participants + Invited), derived from the resolved speaker map so a
  // renamed speaker updates here immediately. Called unconditionally (no
  // useNavigate inside) to keep hook order stable across the null→selected
  // transition; the actual chip UIs (which DO navigate) mount conditionally.
  const people = useReaderPeople({
    meetingId: meeting?.id,
    attendees: meeting?.attendees,
    recordingId,
    segments: transcriptSegments,
  })

  // Timeline duration for the meeting timeline (stored duration, else the live
  // decoded value once the waveform loads). Kept as a hook (above the early
  // return) so the speaker-range memo below has a stable duration input.
  const timelineDurationSec = useMemo(() => {
    if (recording?.duration && recording.duration > 0) return recording.duration
    if (waveformLoadedForId === recording?.id && livePlaybackDuration > 0) return livePlaybackDuration
    return 0
  }, [recording?.duration, recording?.id, waveformLoadedForId, livePlaybackDuration])

  // Per-speaker colored bars + legend, derived CLIENT-SIDE from the transcript.
  // Resolve each raw diarization label to the SAME chip key the Participants list
  // uses (`people.labelColorKey` — which maps a label that resolves to a linked
  // meeting contact onto that contact's `mc:` chip key, not a fallback label key),
  // so a speaker who is ALSO a meeting contact gets ONE shared color: the chip
  // swatch and the waveform bars always match.
  const speakerTimeline = useMemo(
    () => deriveSpeakerRanges(transcriptSegments, timelineDurationSec, (base) => people.labelColorKey.get(base)),
    [transcriptSegments, timelineDurationSec, people.labelColorKey]
  )

  // The recording's action items (parsed once) — the single home for these is the
  // timeline event-list below, NOT the transcript body (H3 de-duplication).
  const actionItems = useMemo(
    () => parseJsonArray<string>(effectiveTranscript?.action_items).map((s) => s.trim()).filter(Boolean),
    [effectiveTranscript?.action_items]
  )

  // H3: Timeline events for the full-mode event-list. Prefer the sibling agent's
  // analysis markers; when those are absent, synthesize numbered markers from the
  // action items so the event-list is ALWAYS the reliable single home for them
  // (and they can be removed from the transcript body without being lost).
  const timelineEvents = useMemo<TimelineEvent[]>(() => {
    if (timeline?.events && timeline.events.length > 0) return timeline.events
    if (actionItems.length === 0 || timelineDurationSec <= 0) return []
    const decisionHint = /\b(decide|decision|approv|agree|ship|conclu|sign off)\b/i
    return actionItems.map((label, i) => {
      const frac = actionItems.length === 1 ? 0.5 : 0.05 + (0.9 * i) / (actionItems.length - 1)
      return {
        id: `ai-${i}`,
        timeSec: Math.min(timelineDurationSec, Math.max(0, frac * timelineDurationSec)),
        index: i + 1,
        label,
        kind: decisionHint.test(label) ? 'decision' : 'action'
      } as TimelineEvent
    })
  }, [timeline?.events, actionItems, timelineDurationSec])

  // Fetch the sibling agent's timeline analysis when a recording opens. Empty or
  // absent → attempt a one-time backfill via analyzeTimeline, then re-read. All
  // optional-cast so this file type-checks and no-ops before that IPC lands.
  useEffect(() => {
    let cancelled = false
    setTimeline(null)
    setAnalyzingTimeline(false)
    if (!recordingId) return
    const api = window.electronAPI?.recordings as unknown as {
      getTimelineAnalysis?: (id: string) => Promise<TimelineAnalysisResult>
      analyzeTimeline?: (id: string) => Promise<unknown>
    } | undefined
    if (typeof api?.getTimelineAnalysis !== 'function') return
    ;(async () => {
      try {
        let res = await api.getTimelineAnalysis!(recordingId)
        const isEmpty = (r?: TimelineAnalysisResult) =>
          !r || ((r.eventMarkers?.length ?? 0) === 0 && (r.sentimentSegments?.length ?? 0) === 0)
        // Already-transcribed recordings return empty until analyzeTimeline runs
        // once. Backfill it (best-effort) and show the "Analyzing timeline…" hint
        // meanwhile; per-speaker colors + playhead already render without this.
        // Guarded to run AT MOST ONCE per recording per reader session: a
        // recording that genuinely has no markers/sentiment (e.g. Gemini not
        // configured, no action items) must not re-trigger a full analysis every
        // time it's reopened.
        if (isEmpty(res) && typeof api.analyzeTimeline === 'function' && !backfillAttemptedRef.current.has(recordingId)) {
          backfillAttemptedRef.current.add(recordingId)
          if (!cancelled) setAnalyzingTimeline(true)
          try {
            await api.analyzeTimeline(recordingId)
            res = await api.getTimelineAnalysis!(recordingId)
          } catch { /* backfill best-effort */ }
          finally { if (!cancelled) setAnalyzingTimeline(false) }
        }
        if (!cancelled && res) setTimeline(mapTimelineAnalysis(res))
      } catch { /* non-fatal: colors + seek still work without it */ }
      finally { if (!cancelled) setAnalyzingTimeline(false) }
    })()
    return () => { cancelled = true }
  }, [recordingId])

  // Scroll-driven collapse: once the body is scrolled a few px past the top, the
  // player morphs from the big timeline to the docked bar (unless pinned). Read
  // synchronously in onScroll (below) — no rAF so it stays deterministic in tests.
  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrolled(e.currentTarget.scrollTop > COLLAPSE_SCROLL_THRESHOLD)
  }, [])

  // B1: a timeline marker (or event-list row) was activated — ask the transcript
  // to scroll to + pulse the turn at this marker's time. A bumped nonce re-fires
  // the pulse for a repeat click on the same marker.
  const handleTimelineEventClick = useCallback((event: TimelineEvent) => {
    highlightNonceRef.current += 1
    setTranscriptHighlight({ atMs: Math.round(event.timeSec * 1000), nonce: highlightNonceRef.current })
  }, [])

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

  // Re-run speaker diarization for this recording via a dedicated IPC (added by a
  // sibling change). Degrades gracefully when the IPC isn't present at runtime.
  const reDiarize = useCallback(async () => {
    if (!recording || !hasLocalPath(recording)) return
    const api = window.electronAPI?.recordings as
      | { reDiarize?: (id: string) => Promise<{ success: boolean; queueItemId?: string; error?: string }> }
      | undefined
    if (typeof api?.reDiarize !== 'function') {
      toast.error('Re-diarize unavailable', 'This build does not support re-diarizing yet.')
      return
    }
    setReDiarizing(true)
    try {
      const res = await api.reDiarize(recording.id)
      if (!res?.success) {
        toast.error('Failed to re-diarize', res?.error || 'Could not start re-diarization')
        setReDiarizing(false)
        return
      }
      if (res.queueItemId) addToQueue(res.queueItemId, recording.id, recording.filename)
      toast.success('Re-diarizing speakers', recording.filename)
    } catch (err) {
      toast.error('Failed to re-diarize', err instanceof Error ? err.message : undefined)
      setReDiarizing(false)
    }
  }, [recording, addToQueue])

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
  const { primaryText: displayTitle } = getDisplayTitle(recording, meeting, effectiveTranscript)

  // Prefer the stored duration; fall back to the live decoded value for the
  // recording whose waveform is currently loaded (computed as a hook above).
  const durationSeconds = timelineDurationSec

  // Transcription is "busy" while queued or running — the primary Transcribe
  // control and its ▾ trigger are disabled in that window.
  const isTranscribeBusy =
    recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'

  const isTranscribed = recording.transcriptionStatus === 'complete'

  // The transcription method menu offered by the ▾ trigger. Shared by both the
  // "Transcribe ▾" (fresh) and "Re-transcribe ▾" (already-done) forms. The
  // Re-diarize item only makes sense once a transcript with speakers exists.
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
      {isTranscribed && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={reDiarize} disabled={reDiarizing}>
            <UserCog className="h-4 w-4" aria-hidden="true" />
            {reDiarizing ? 'Re-diarizing…' : 'Re-diarize this recording'}
          </DropdownMenuItem>
        </>
      )}
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
      {/* ===================================================================
          DOCKED HEADER — stays put while the body scrolls.
          Title + status + curated meta + primary CTAs + compact player +
          Participants chips.
          =================================================================== */}
      <div className="shrink-0 border-b bg-background">
        {/* Title row */}
        <div className="flex items-start gap-2 px-4 pt-4">
          {isEditingTitle ? (
            <div className="flex flex-1 items-center gap-2">
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle()
                  if (e.key === 'Escape') handleCancelTitle()
                }}
                className="text-lg font-semibold h-auto py-1"
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
            <div className="group flex min-w-0 flex-1 items-center gap-2">
              <h2 className="text-lg font-semibold line-clamp-2 leading-tight" title={displayTitle}>
                {displayTitle}
              </h2>
              {recording.knowledgeCaptureId && (
                <button
                  onClick={() => {
                    setIsEditingTitle(true)
                    setEditedTitle(recording.title || displayTitle)
                  }}
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 shrink-0"
                  aria-label="Edit title"
                  title="Edit title"
                >
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Curated meta strip: date · duration · location · status */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {formatSmartDate(recording.dateRecorded, { fallback: 'Unknown' })}
            {(() => {
              const rel = formatRelativeDate(recording.dateRecorded)
              return rel ? <span className="text-muted-foreground/70">· {rel}</span> : null
            })()}
          </span>
          <span aria-hidden="true" className="text-muted-foreground/40">•</span>
          <span>{durationSeconds > 0 ? formatDuration(durationSeconds) : 'Unknown'}</span>
          <span aria-hidden="true" className="text-muted-foreground/40">•</span>
          <span className="inline-flex items-center gap-1">
            <StatusIcon recording={recording} />
          </span>
          <TranscriptionStatusBadge status={recording.transcriptionStatus} />
        </div>

        {/* Primary CTAs */}
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
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

          {/* Transcription split button (Transcribe / Re-transcribe ▾). */}
          {hasLocalPath(recording) && (
            isTranscribed ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5" title="Re-transcribe or re-diarize with a chosen method">
                    <Wand2 className="h-4 w-4" />
                    Re-transcribe
                    <ChevronDown className="h-4 w-4 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">{transcribeMenuItems}</DropdownMenuContent>
              </DropdownMenu>
            ) : (
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
                  <DropdownMenuContent align="start" className="w-56">{transcribeMenuItems}</DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          )}

          {/* Source-scoped assistant */}
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

        {/* THE waveform — a SINGLE element. Big rich timeline by default (reader
            at top); morphs to a full-width docked bar as the body scrolls; the
            pin keeps it big while scrolling. Never renders a second copy. */}
        {canPlay && (
          <div className="px-4 pt-3 pb-3">
            <ReaderPlayer
              recordingId={recording.id}
              filePath={localPath}
              durationSec={durationSeconds}
              speakerRanges={speakerTimeline.ranges}
              events={timelineEvents}
              sentiment={timeline?.sentiment}
              analyzing={analyzingTimeline}
              scrolled={scrolled}
              pinned={waveformPinned}
              onTogglePin={() => setWaveformPinned(!waveformPinned)}
              onSeek={(sec) => onSeek?.(Math.round(sec * 1000))}
              onEventClick={handleTimelineEventClick}
            />
          </div>
        )}

        {/* Participants (who actually spoke) — docked, actionable chips. */}
        {people.participants.length > 0 && (
          <div className="px-4 pb-3">
            <ParticipantsChips
              participants={people.participants}
              contacts={people.allContacts}
              colorByKey={speakerTimeline.colorByKey}
              onOpenPicker={people.ensureAllContacts}
              onAssign={people.assignSpeaker}
              onUnassign={people.unassignSpeaker}
            />
          </div>
        )}

        {/* Essentials — Size · Category · Filename · Projects stay DOCKED (visible
            while the body scrolls); only Summary / Action Items / Transcript scroll. */}
        <div className="border-t px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 @md:grid-cols-3 @xl:grid-cols-4 gap-x-4 gap-y-2 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-0.5">Size</p>
              <p>{recording.size ? formatBytes(recording.size) : 'Unknown'}</p>
            </div>
            {recording.quality && recording.quality !== 'unrated' && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Quality</p>
                <p className="capitalize">{recording.quality.replace('-', ' ')}</p>
              </div>
            )}
            {recording.knowledgeCaptureId ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Category</p>
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
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Category</p>
                <p className="capitalize">{recording.category}</p>
              </div>
            ) : null}
            <div className="col-span-2">
              <p className="text-xs font-medium text-muted-foreground mb-0.5">Filename</p>
              <p className="truncate" title={recording.filename}>{recording.filename}</p>
            </div>
          </div>

          {recording.knowledgeCaptureId && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Projects</p>
              <ProjectAssignmentRow knowledgeCaptureId={recording.knowledgeCaptureId} />
            </div>
          )}
        </div>
      </div>

      {/* ===================================================================
          SCROLL BODY — Summary / Action Items / Transcript (+ meeting context).
          Its scroll position drives the docked player's collapse.
          =================================================================== */}
      <div
        ref={scrollRef}
        onScroll={handleBodyScroll}
        className="flex-1 min-h-0 overflow-y-auto"
        data-testid="reader-scroll-body"
      >
        <div className="p-6 space-y-4">
          {/* Linked Meeting */}
          {meeting && (
            <div className="flex items-center gap-2 p-3 bg-muted/30 border rounded-lg">
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

          {/* Invited (calendar attendees) — DISTINCT from Participants. */}
          {meeting && (
            <InvitedChips
              invited={people.invited}
              resolveAttendee={people.resolveAttendee}
              spokeKey={people.attendeeSpoke}
            />
          )}

          {/* Device-only notice */}
          {isDeviceOnly(recording) && (
            <p className="text-xs text-muted-foreground italic">
              Download this capture to play it and generate a transcript.
            </p>
          )}

          {/* Transcript Content */}
          <div>
            {effectiveTranscript ? (
              <TranscriptViewer
                transcript={effectiveTranscript.full_text}
                segments={transcriptSegments}
                recordingId={recording.id}
                currentTimeMs={currentTimeMs}
                isPlaying={isPlaying}
                highlightRequest={transcriptHighlight}
                onSeek={onSeek || (() => {})}
                showSummary={true}
                /* H3: action items live in ONE home — the timeline event-list above.
                   Keep them out of the transcript body to avoid duplication. */
                showActionItems={false}
                summary={effectiveTranscript.summary ?? undefined}
                actionItems={actionItems}
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
 * ReaderPlayer — the SINGLE waveform element for the reader.
 *
 * There is never a second copy: this one element is the big rich meeting timeline
 * by DEFAULT (reader scrolled to top) and MORPHS into a full-width docked player
 * bar as the body scrolls. State is driven by:
 *   - `scrolled` (body scroll position): big at top → docked bar once scrolled.
 *   - `pinned`  (explicit "keep expanded", persisted): overrides the scroll
 *     collapse so the big timeline stays open even while scrolling.
 *   - measured width: the docked bar drops to the bare scrubber below a breakpoint.
 *
 * The morph is animated (max-height + opacity), honoring prefers-reduced-motion
 * via Tailwind's `motion-safe:` variants (instant swap when reduced).
 */
interface ReaderPlayerProps {
  recordingId: string
  filePath?: string
  /** Real recording duration (seconds) — the rich-timeline time axis. */
  durationSec: number
  speakerRanges: DerivedSpeakerRange[]
  events?: TimelineEvent[]
  sentiment?: SentimentScorePoint[]
  analyzing: boolean
  scrolled: boolean
  pinned: boolean
  onTogglePin: () => void
  onSeek: (sec: number) => void
  /** A numbered marker / event-list row was activated (B1 cross-highlight). */
  onEventClick?: (event: TimelineEvent) => void
}

function ReaderPlayer({
  recordingId,
  filePath,
  durationSec,
  speakerRanges,
  events,
  sentiment,
  analyzing,
  scrolled,
  pinned,
  onTogglePin,
  onSeek,
  onEventClick,
}: ReaderPlayerProps) {
  const regionRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)

  // Big (rich timeline) unless the body is scrolled — and the pin forces it big.
  const big = pinned || !scrolled
  const narrow = width != null && width < NARROW_WIDTH_BREAKPOINT
  const mode: WaveformPlayerMode = big ? 'full' : narrow ? 'scrubber' : 'pill'

  // Track the reader pane width to choose the docked bar vs. the bare scrubber.
  useLayoutEffect(() => {
    const el = regionRef.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Animate height between big and docked by measuring the live content height.
  // Only cap when we have a real measurement, so the player is never clipped to 0
  // (jsdom/SSR report scrollHeight 0 → leave it uncapped and fully visible).
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const sync = () => {
      const h = el.scrollHeight
      if (h > 0) setMaxHeight(h)
    }
    sync()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(sync)
      ro.observe(el)
      return () => ro.disconnect()
    }
    return
  }, [mode, big, narrow])

  return (
    <div ref={regionRef} className="relative flex items-start gap-1" data-testid="reader-player-region">
      <div
        className="relative min-w-0 flex-1 overflow-hidden rounded-lg motion-safe:transition-[max-height] motion-safe:duration-300 motion-safe:ease-out"
        style={{ maxHeight }}
      >
        <div ref={innerRef} className="motion-safe:transition-opacity motion-safe:duration-200">
          <WaveformPlayer
            mode={mode}
            fluid
            recordingId={recordingId}
            filePath={filePath}
            durationSec={durationSec}
            speakerRanges={big ? speakerRanges : undefined}
            events={big ? events : undefined}
            sentiment={big ? sentiment : undefined}
            onSeek={onSeek}
            onEventClick={onEventClick}
          />
        </div>

        {/* Subtle backfill indicator — sentiment + markers are still computing.
            Colored bars + playhead already render; this just explains the wait. */}
        {big && analyzing && (
          <div
            className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur"
            data-testid="timeline-analyzing"
            role="status"
          >
            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
            Analyzing timeline…
          </div>
        )}
      </div>

      {/* Keep-expanded pin — overrides the scroll-collapse; persisted per user. */}
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-8 w-8 shrink-0', pinned && 'text-primary')}
        onClick={onTogglePin}
        aria-pressed={pinned}
        aria-label={pinned ? 'Allow timeline to collapse on scroll' : 'Keep timeline expanded'}
        title={pinned ? 'Pinned open — click to let it collapse when you scroll' : 'Keep the timeline expanded while scrolling'}
      >
        <Pin className={cn('h-4 w-4', pinned && 'fill-current')} />
      </Button>
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
 * ParticipantsChips — "who actually spoke" as actionable chips.
 *
 * Each chip's affordance follows the recording's resolved speaker map:
 *  - Resolved to a contact  → the chip is the person's name, links to their page
 *    (/person/:id), and hovers into a PersonHoverCard.
 *  - Unresolved diarization label ("Speaker 3") → the chip opens the SAME
 *    SpeakerAssignPopover the transcript uses, so it can be named/reassigned in
 *    place. Because names come from the resolved map, a correction made here (or
 *    in the transcript) shows in both lists.
 *
 * Uses useNavigate, so it is only mounted when there are participants to show —
 * keeping the reader Router-independent for a bare recording.
 */
function ParticipantsChips({
  participants,
  contacts,
  colorByKey,
  onOpenPicker,
  onAssign,
  onUnassign,
}: {
  participants: ParticipantChip[]
  contacts: import('@/types/knowledge').Person[]
  /** speakerKey → color, so a chip shows the SAME swatch as its waveform bars. */
  colorByKey?: Map<string, string>
  onOpenPicker: () => void
  onAssign: (effectiveLabel: string, turnIndex: number, scope: AssignScope, payload: { contactId?: string; newName?: string }) => void
  onUnassign: (effectiveLabel: string, turnIndex: number) => void
}) {
  const navigate = useNavigate()
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        Participants ({participants.length})
        <span className="font-normal text-muted-foreground/70">From transcripts</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {participants.map((p) => {
          const turnHint = p.turnCount > 0 ? ` · ${p.turnCount} turn${p.turnCount === 1 ? '' : 's'}` : ''
          const swatch = colorByKey?.get(p.key)
          if (p.contactId) {
            // Resolved to a known person → link to their page, hover for details.
            return (
              <HoverCard key={p.key}>
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    onClick={() => navigate(`/person/${p.contactId}`)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    title={`View ${p.name}${turnHint}`}
                  >
                    {swatch && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: swatch }} aria-hidden="true" />}
                    {p.name}
                  </button>
                </HoverCardTrigger>
                <HoverCardContent align="start" className="w-64">
                  <PersonHoverCard id={p.contactId} name={p.name} />
                </HoverCardContent>
              </HoverCard>
            )
          }
          // Unresolved diarization label → assign/rename in place.
          return (
            <span
              key={p.key}
              className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5 text-xs"
              title={`${p.name}${turnHint} — click to identify`}
            >
              {swatch && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: swatch }} aria-hidden="true" />}
              <SpeakerAssignPopover
                label={p.effectiveLabel}
                turnIndex={p.firstTurnIndex}
                assignedContactId={undefined}
                assignedName={undefined}
                assignmentScope={undefined}
                contacts={contacts}
                onOpen={onOpenPicker}
                onAssign={(scope, payload) => onAssign(p.effectiveLabel, p.firstTurnIndex, scope, payload)}
                onUnassign={() => onUnassign(p.effectiveLabel, p.firstTurnIndex)}
                canSplitHere={false}
                hasSplitHere={false}
                onSplit={() => {}}
                onMergeSplit={() => {}}
                mergeSuspected={p.mergeSuspected}
              />
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * InvitedChips — the calendar-invited attendees (meeting.attendees). This is who
 * was INVITED, which is DIFFERENT from who spoke; the two lists are shown
 * separately. Attendees resolve to a contact where possible (deep-linkable), and
 * a "spoke" tag marks the invited people we can map to a transcript speaker.
 */
function InvitedChips({
  invited,
  resolveAttendee,
  spokeKey,
}: {
  invited: MeetingAttendee[]
  resolveAttendee: (a: MeetingAttendee) => import('@/types').Contact | undefined
  spokeKey: (a: MeetingAttendee, contactId?: string) => boolean
}) {
  const navigate = useNavigate()
  return (
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
            const spoke = spokeKey(a, contact?.id)
            const spokeTag = spoke ? (
              <span className="ml-1 rounded bg-primary/15 px-1 text-[10px] font-medium text-primary" title="Mapped to a transcript speaker">
                spoke
              </span>
            ) : null
            return contact ? (
              <button
                key={`inv-${i}`}
                type="button"
                onClick={() => navigate(`/person/${contact.id}`)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title={`View ${label}`}
              >
                {label}
                {spokeTag}
              </button>
            ) : (
              <span
                key={`inv-${i}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs"
                title={label}
              >
                {label}
                {spokeTag}
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
  )
}
