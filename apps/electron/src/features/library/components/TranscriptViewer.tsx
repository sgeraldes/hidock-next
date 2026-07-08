/**
 * TranscriptViewer Component
 *
 * A reusable component for displaying transcripts with interactive timestamps.
 * Parses timestamps, renders TimeAnchor components, highlights the current segment,
 * and auto-scrolls during playback.
 */

import { useEffect, useRef, useMemo, useState } from 'react'
import { TimeAnchor } from './TimeAnchor'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { expandInlineStoredSegments } from '../utils/splitInlineTurns'

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
  const cleaned = timestampStr.replace(/[\[\]]/g, '').trim()

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
  segments: storedSegments
}: TranscriptViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeSegmentRef = useRef<HTMLDivElement>(null)

  const [summaryExpanded, setSummaryExpanded] = useState(true)
  const [actionItemsExpanded, setActionItemsExpanded] = useState(true)
  const [transcriptExpanded, setTranscriptExpanded] = useState(true)

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

  // Auto-scroll to current segment during playback
  useEffect(() => {
    if (currentSegmentIndex >= 0 && activeSegmentRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }, [currentSegmentIndex])

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
        <button
          onClick={() => setTranscriptExpanded(!transcriptExpanded)}
          className="flex items-center justify-between w-full text-left hover:text-foreground/70 transition-colors"
          aria-expanded={transcriptExpanded}
        >
          <span className="text-sm font-semibold">Full Transcript</span>
          {transcriptExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {transcriptExpanded && (
          <div ref={containerRef} className="mt-2 pr-1">
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
                          <span className="font-semibold text-foreground">
                            {segment.speaker}
                          </span>
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
