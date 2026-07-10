/**
 * TranscriptViewer Component
 *
 * A reusable component for displaying transcripts with interactive timestamps.
 * Parses timestamps, renders TimeAnchor components, highlights the current segment,
 * and auto-scrolls during playback.
 */

import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { TimeAnchor } from './TimeAnchor'
import { SpeakerAssignPopover } from './SpeakerAssignPopover'
import { ChevronDown, ChevronRight, ArrowDownToLine } from 'lucide-react'
import { expandInlineStoredSegments } from '../utils/splitInlineTurns'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { toast } from '@/components/ui/toaster'
import type { Person } from '@/types/knowledge'

/** Stored transcript segment (from the `speakers` JSON column). Times in seconds. */
export interface StoredSegment {
  speaker?: string
  start: number
  end?: number
  text: string
}

interface TranscriptViewerProps {
  transcript: string
  currentTimeMs?: number
  onSeek: (startMs: number, endMs?: number) => void
  showSummary?: boolean
  showActionItems?: boolean
  summary?: string
  actionItems?: string[]
  /**
   * Pre-parsed speaker/timestamp segments (e.g. from Gemini's structured
   * output or local ASR). When present, these are rendered directly as turns
   * instead of re-parsing the plain `transcript` string.
   */
  segments?: StoredSegment[]
  /**
   * When provided, speaker labels become interactive: each can be assigned to a
   * canonical contact (existing or new). Assignments are resolved through the
   * recording's speaker map so every turn with the same label renders the
   * person's name. Omit to render labels as plain, non-interactive text.
   */
  recordingId?: string
}

interface TranscriptSegment {
  startMs: number
  endMs?: number
  text: string
  speaker?: string
}

/**
 * Break a plain, unstructured transcript into readable paragraphs so an
 * old-style single-blob transcript (no newlines, no speaker labels) doesn't
 * render as one unbroken wall of text. Splits on existing newlines first, then
 * subdivides any long run into ~sentence groups.
 */
function toParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  for (const block of text.split(/\n+/).map((b) => b.trim()).filter(Boolean)) {
    if (block.length <= 600) {
      paragraphs.push(block)
      continue
    }
    const sentences = block.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [block]
    let current = ''
    for (const sentence of sentences) {
      current += sentence
      if (current.length >= 350) {
        paragraphs.push(current.trim())
        current = ''
      }
    }
    if (current.trim()) paragraphs.push(current.trim())
  }
  return paragraphs.length > 0 ? paragraphs : [text.trim()]
}

/** Map stored (seconds-based) segments to the viewer's internal ms-based shape.
 * Legacy segments that packed a whole chunk into one text blob with inline
 * `[MM:SS] Speaker N:` markers are first re-split into individual turns so they
 * render correctly without re-transcription. */
function fromStoredSegments(stored: StoredSegment[]): TranscriptSegment[] {
  return expandInlineStoredSegments(stored)
    .filter((s) => s.text?.trim())
    .map((s) => ({
      startMs: Math.round((s.start || 0) * 1000),
      endMs: s.end != null ? Math.round(s.end * 1000) : undefined,
      speaker: s.speaker,
      text: s.text.trim()
    }))
}

/**
 * Parse speaker name from text. Supports, at the start of the text:
 *   **Speaker Name:**   / **Speaker Name**:   / **Speaker Name**   (markdown-bold)
 *   [Speaker Name]
 *   Speaker Name:
 */
function parseSpeaker(text: string): { speaker: string | undefined; remainingText: string } {
  const trimmed = text.trimStart()

  // Markdown-bold label: **Name:** rest / **Name**: rest / **Name** rest
  // [^*\n]+? captures the name (and any inner colon); trailing colon is stripped below.
  const boldMatch = trimmed.match(/^\*\*\s*([^*\n]+?)\s*\*\*\s*:?\s*([\s\S]*)$/)
  if (boldMatch) {
    return { speaker: boldMatch[1].replace(/:\s*$/, '').trim(), remainingText: boldMatch[2].trim() }
  }

  // "[Speaker Name]" format
  const bracketMatch = trimmed.match(/^\[([^\]]+)\]\s*([\s\S]*)$/)
  if (bracketMatch) {
    return { speaker: bracketMatch[1].trim(), remainingText: bracketMatch[2].trim() }
  }

  // "Speaker Name:" format (capitalised, no colon inside the name)
  const colonMatch = trimmed.match(/^([A-Z][^:\n]*?):\s+([\s\S]*)$/)
  if (colonMatch) {
    return { speaker: colonMatch[1].trim(), remainingText: colonMatch[2].trim() }
  }

  return { speaker: undefined, remainingText: text }
}

// A line that begins a new speaker turn (markdown-bold, bracket, or "Name:").
const SPEAKER_LINE_REGEX = /^[ \t]*(?:\*\*[^*\n]+\*\*\s*:?|\[[^\]\n]+\]|[A-Z][^:\n]{0,40}?:)\s/

/**
 * Parse a transcript with no timestamps into speaker turns. Each turn starts at
 * a line with a speaker label; continuation lines are appended to the turn.
 * Returns a single plain segment when no speaker labels are present.
 */
function parseSpeakerSegments(transcript: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let current: TranscriptSegment | null = null

  for (const line of transcript.split('\n')) {
    if (SPEAKER_LINE_REGEX.test(line)) {
      if (current) segments.push(current)
      const { speaker, remainingText } = parseSpeaker(line)
      current = { startMs: 0, speaker, text: remainingText }
    } else if (current) {
      current.text += line.trim() ? `\n${line.trim()}` : ''
    } else if (line.trim()) {
      current = { startMs: 0, text: line.trim() }
    }
  }
  if (current) segments.push(current)

  return segments.length > 0 ? segments : [{ startMs: 0, text: transcript.trim() }]
}

/**
 * Parse timestamps from transcript text.
 * Supports formats: [MM:SS], [HH:MM:SS], MM:SS, HH:MM:SS
 */
function parseTimestamp(timestampStr: string): number | null {
  // Remove brackets if present
  const cleaned = timestampStr.replace(/[[\]]/g, '').trim()

  // Split by colons
  const parts = cleaned.split(':').map(part => parseInt(part, 10))

  if (parts.some(isNaN)) {
    return null
  }

  let totalSeconds = 0

  if (parts.length === 2) {
    // MM:SS format
    const [minutes, seconds] = parts
    totalSeconds = minutes * 60 + seconds
  } else if (parts.length === 3) {
    // HH:MM:SS format
    const [hours, minutes, seconds] = parts
    totalSeconds = hours * 3600 + minutes * 60 + seconds
  } else {
    return null
  }

  return totalSeconds * 1000 // Convert to milliseconds
}

/**
 * Parse transcript into segments with timestamps.
 * Detects timestamps in formats: [MM:SS], [HH:MM:SS], bare MM:SS, HH:MM:SS at line start
 */
function parseTranscriptSegments(transcript: string): { segments: TranscriptSegment[]; hasTimestamps: boolean } {
  const segments: TranscriptSegment[] = []

  // Regex to match timestamps at the start of a line (with optional brackets)
  // Matches: [00:15], [00:15:30], 00:15, 00:15:30 at line start
  const timestampRegex = /^(\[?\d{1,2}:\d{2}(?::\d{2})?\]?)\s+(.*)$/gm

  let match: RegExpExecArray | null

  while ((match = timestampRegex.exec(transcript)) !== null) {
    const [, timestampStr, text] = match
    const startMs = parseTimestamp(timestampStr)

    if (startMs !== null) {
      // Set endMs of previous segment
      if (segments.length > 0) {
        segments[segments.length - 1].endMs = startMs
      }

      // Parse speaker name from text
      const { speaker, remainingText } = parseSpeaker(text.trim())

      segments.push({
        startMs,
        text: remainingText,
        speaker
      })
    }
  }

  if (segments.length > 0) {
    return { segments, hasTimestamps: true }
  }

  // No timestamps — fall back to speaker-turn parsing (handles **Name:** etc.)
  return { segments: parseSpeakerSegments(transcript), hasTimestamps: false }
}

export function TranscriptViewer({
  transcript,
  currentTimeMs,
  onSeek,
  showSummary = true,
  showActionItems = true,
  summary,
  actionItems,
  segments: storedSegments,
  recordingId
}: TranscriptViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeSegmentRef = useRef<HTMLDivElement>(null)

  const [summaryExpanded, setSummaryExpanded] = useState(true)
  const [actionItemsExpanded, setActionItemsExpanded] = useState(true)
  const [transcriptExpanded, setTranscriptExpanded] = useState(true)

  // Auto-follow: while audio plays, keep the current turn in view. We must not
  // fight the user — a manual scroll pauses following until the next play or an
  // explicit "Follow" tap. Reduced-motion users get instant (non-smooth) jumps.
  const [autoFollow, setAutoFollow] = useState(true)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const prevTimeMsRef = useRef<number | undefined>(undefined)

  // Speaker → contact assignment. Only active when a recordingId is supplied.
  // speakerMap resolves a raw label ("Speaker 2") to the assigned contact; the
  // contacts list backs the popover's searchable picker (loaded lazily).
  const assignEnabled = Boolean(recordingId)
  const [speakerMap, setSpeakerMap] = useState<Map<string, { contactId: string; name: string }>>(new Map())
  const [contacts, setContacts] = useState<Person[]>([])
  const [contactsLoaded, setContactsLoaded] = useState(false)

  const loadSpeakerMap = useCallback(async () => {
    if (!recordingId) {
      setSpeakerMap(new Map())
      return
    }
    try {
      const res = await window.electronAPI.transcripts.getSpeakerMap({ recordingId })
      if (res.success) {
        const next = new Map<string, { contactId: string; name: string }>()
        for (const row of res.data) next.set(row.speaker_label, { contactId: row.contact_id, name: row.name })
        setSpeakerMap(next)
      }
    } catch {
      // Non-fatal: labels simply render un-resolved.
    }
  }, [recordingId])

  useEffect(() => {
    loadSpeakerMap()
  }, [loadSpeakerMap])

  const ensureContacts = useCallback(async () => {
    if (contactsLoaded) return
    try {
      const res = await window.electronAPI.contacts.getAll()
      if (res.success) setContacts(res.data.contacts)
    } catch {
      // Non-fatal: picker shows an empty list, create-new still works.
    } finally {
      setContactsLoaded(true)
    }
  }, [contactsLoaded])

  const assignSpeaker = useCallback(
    async (label: string, payload: { contactId?: string; newName?: string }) => {
      if (!recordingId) return
      try {
        const res = await window.electronAPI.transcripts.assignSpeaker({ recordingId, speakerLabel: label, ...payload })
        if (res.success) {
          await loadSpeakerMap()
          setContactsLoaded(false) // a new person may have been created
          toast.success('Speaker assigned', `${label} is now ${res.data.name}.`)
        } else {
          toast.error('Failed to assign speaker')
        }
      } catch (err) {
        toast.error('Failed to assign speaker', err instanceof Error ? err.message : undefined)
      }
    },
    [recordingId, loadSpeakerMap]
  )

  const unassignSpeaker = useCallback(
    async (label: string) => {
      if (!recordingId) return
      try {
        const res = await window.electronAPI.transcripts.unassignSpeaker({ recordingId, speakerLabel: label })
        if (res.success) {
          await loadSpeakerMap()
          toast.success('Speaker unassigned')
        } else {
          toast.error('Failed to unassign speaker')
        }
      } catch (err) {
        toast.error('Failed to unassign speaker', err instanceof Error ? err.message : undefined)
      }
    },
    [recordingId, loadSpeakerMap]
  )

  // Prefer pre-parsed segments (timestamped speaker turns) when available;
  // otherwise parse the plain transcript string (timestamped or speaker-turn based).
  const { segments, hasTimestamps } = useMemo(() => {
    if (storedSegments && storedSegments.length > 0) {
      const mapped = fromStoredSegments(storedSegments)
      if (mapped.length > 0) {
        return { segments: mapped, hasTimestamps: mapped.some((s) => s.startMs > 0) }
      }
    }
    return parseTranscriptSegments(transcript)
  }, [storedSegments, transcript])

  // Find current segment index based on currentTimeMs (only meaningful with timestamps)
  const currentSegmentIndex = useMemo(() => {
    if (!hasTimestamps || currentTimeMs === undefined) return -1

    return segments.findIndex((seg, i) => {
      const isAfterStart = currentTimeMs >= seg.startMs
      const isBeforeEnd = i === segments.length - 1 || (seg.endMs && currentTimeMs < seg.endMs)
      return isAfterStart && isBeforeEnd
    })
  }, [segments, currentTimeMs, hasTimestamps])

  // A (re)start of playback re-enables following: undefined→defined means this
  // transcript's audio just started (e.g. MeetingDetail, where currentTimeMs is
  // undefined unless this recording is the one playing), and a jump back to the
  // very start means a stop→play restart (position resets toward 0).
  useEffect(() => {
    const prev = prevTimeMsRef.current
    prevTimeMsRef.current = currentTimeMs
    if (currentTimeMs === undefined) return
    const started =
      prev === undefined || (currentTimeMs < 1200 && prev - currentTimeMs > 400)
    if (started) setAutoFollow(true)
  }, [currentTimeMs])

  // Auto-scroll to current segment during playback, unless the user paused
  // following by scrolling manually. Reduced motion → instant (WCAG 2.3.3).
  useEffect(() => {
    if (!autoFollow) return
    if (currentSegmentIndex >= 0 && activeSegmentRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'center'
      })
    }
  }, [currentSegmentIndex, autoFollow, prefersReducedMotion])

  // A manual scroll intent (wheel / touch drag) over the transcript pauses
  // auto-follow so we don't yank the view back while the user is reading. Only
  // meaningful once we have timestamps to follow.
  const pauseFollowOnManualScroll = useCallback(() => {
    if (hasTimestamps) setAutoFollow(false)
  }, [hasTimestamps])

  // Render structured turns when we have timestamps or detected speakers; else plain text
  const hasStructure = hasTimestamps || segments.some((seg) => seg.speaker)

  return (
    <div className="divide-y divide-border">
      {/* Summary Section */}
      {showSummary && summary && (
        <section className="py-3 first:pt-0">
          <button
            onClick={() => setSummaryExpanded(!summaryExpanded)}
            className="flex items-center justify-between w-full text-left hover:text-foreground/70 transition-colors"
            aria-expanded={summaryExpanded}
          >
            <span className="text-sm font-semibold">Summary</span>
            {summaryExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {summaryExpanded && (
            <p className="text-sm whitespace-pre-wrap leading-relaxed mt-2">{summary}</p>
          )}
        </section>
      )}

      {/* Action Items Section */}
      {showActionItems && actionItems && actionItems.length > 0 && (
        <section className="py-3 first:pt-0">
          <button
            onClick={() => setActionItemsExpanded(!actionItemsExpanded)}
            className="flex items-center justify-between w-full text-left hover:text-foreground/70 transition-colors"
            aria-expanded={actionItemsExpanded}
          >
            <span className="text-sm font-semibold">Action Items</span>
            {actionItemsExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {actionItemsExpanded && (
            <ul className="list-disc list-inside text-sm space-y-1 mt-2">
              {actionItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Full Transcript Section */}
      <section className="py-3 first:pt-0 last:pb-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTranscriptExpanded(!transcriptExpanded)}
            className="flex items-center justify-between flex-1 text-left hover:text-foreground/70 transition-colors"
            aria-expanded={transcriptExpanded}
          >
            <span className="text-sm font-semibold">Full Transcript</span>
            {transcriptExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {/* Resume auto-follow after a manual scroll paused it (only relevant
              for timestamped transcripts that can follow playback). */}
          {hasTimestamps && !autoFollow && (
            <button
              onClick={() => setAutoFollow(true)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-primary hover:bg-accent transition-colors"
              title="Resume auto-scroll to follow playback"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Follow
            </button>
          )}
        </div>
        {transcriptExpanded && (
          <div
            ref={containerRef}
            className="mt-2 pr-1"
            onWheel={pauseFollowOnManualScroll}
            onTouchMove={pauseFollowOnManualScroll}
          >
            {hasStructure ? (
              <div className="space-y-1">
                {segments.map((segment, i) => (
                  <div
                    key={i}
                    ref={hasTimestamps && i === currentSegmentIndex ? activeSegmentRef : null}
                    className={`text-sm p-2 rounded-md transition-colors ${
                      hasTimestamps && i === currentSegmentIndex ? 'bg-primary/10' : ''
                    }`}
                  >
                    {(hasTimestamps || segment.speaker) && (
                      <div className="flex items-center gap-2 mb-1">
                        {hasTimestamps && (
                          <TimeAnchor
                            startMs={segment.startMs}
                            endMs={segment.endMs}
                            isActive={i === currentSegmentIndex}
                            onSeek={onSeek}
                          >
                            {null}
                          </TimeAnchor>
                        )}
                        {segment.speaker && (
                          assignEnabled ? (
                            <SpeakerAssignPopover
                              label={segment.speaker}
                              assignedContactId={speakerMap.get(segment.speaker)?.contactId}
                              assignedName={speakerMap.get(segment.speaker)?.name}
                              contacts={contacts}
                              onOpen={ensureContacts}
                              onAssignContact={(contactId) => assignSpeaker(segment.speaker!, { contactId })}
                              onAssignNew={(name) => assignSpeaker(segment.speaker!, { newName: name })}
                              onUnassign={() => unassignSpeaker(segment.speaker!)}
                            />
                          ) : (
                            <span className="font-semibold text-foreground">
                              {segment.speaker}
                            </span>
                          )
                        )}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{segment.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {toParagraphs(transcript).map((para, i) => (
                  <p key={i} className="text-sm whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                    {para}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
